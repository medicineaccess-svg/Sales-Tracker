-- =====================================================================
-- Migration 6: performance model for the "NPM Sales sheet" (v2 layout)
--
--  * npp_sales gains the sheet's Zone column plus two derived columns:
--      zone_base  "HO South Zone" → "South Zone" (HO sales roll into their base zone)
--      channel    individual | ho | ho_third_party | unassigned  (from the manager column)
--  * sales_managers  — master data (aliases, zone, branch, sales-manager flag)
--  * sales_targets   — MONTHLY targets per manager / zone / company. Annual figures are
--                      always the sum of months that were explicitly entered; the database
--                      never divides an annual number across months.
--  * npp_sync_apply_v2 — field-aware upsert: only columns the sheet provides are written,
--                      and v1 records are adopted (kept, re-keyed) instead of duplicated.
--  * npp_sheet_uploads — staged sheet snapshots / CSV uploads (service role only).
--  * npp_performance — monthly fact rows + targets for the performance dashboards.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. npp_sales: zone, zone_base, channel
-- ---------------------------------------------------------------------
alter table public.npp_sales
  add column zone text check (zone is null or length(zone) <= 80);

alter table public.npp_sales
  add column zone_base text generated always as (
    nullif(regexp_replace(btrim(regexp_replace(coalesce(zone, ''), '\s+', ' ', 'g')), '^HO\s+', '', 'i'), '')
  ) stored;

alter table public.npp_sales
  add column channel text generated always as (
    case
      when manager is null or btrim(manager) = '' then 'unassigned'
      when manager ~* '^\s*HO\s*\(?\s*third\s*party' then 'ho_third_party'
      when manager ~* '^\s*HO\s*$' then 'ho'
      else 'individual'
    end
  ) stored;

create index npp_sales_zone_idx on public.npp_sales (zone_base);
create index npp_sales_channel_idx on public.npp_sales (channel);

alter table public.sync_runs drop constraint sync_runs_trigger_check;
alter table public.sync_runs add constraint sync_runs_trigger_check
  check (trigger in ('initial', 'manual', 'scheduled', 'upload'));
alter table public.sync_runs add column adopted int not null default 0;

-- Guard trigger: zone is a business field (local edits mark the row as locally modified)
create or replace function public.npp_sales_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync boolean := coalesce(current_setting('app.npp_sync_run', true), '') <> '';
  v_uid uuid := auth.uid();
begin
  if v_sync then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.source := 'manual';
    new.source_key := null;
    new.source_sheet_id := null;
    new.source_gid := null;
    new.source_row_number := null;
    new.source_hash := null;
    new.source_raw := null;
    new.last_synced_at := null;
    new.missing_from_source_at := null;
    new.pending_source := null;
    new.sync_run_id := null;
    new.locally_modified := false;
    new.status := 'active';
    new.archived_at := null;
    new.archived_by := null;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := v_uid;
    new.updated_by := v_uid;
    return new;
  end if;

  new.id := old.id;
  new.source := old.source;
  new.source_key := old.source_key;
  new.source_sheet_id := old.source_sheet_id;
  new.source_gid := old.source_gid;
  new.source_row_number := old.source_row_number;
  new.source_hash := old.source_hash;
  new.source_raw := old.source_raw;
  new.last_synced_at := old.last_synced_at;
  new.missing_from_source_at := old.missing_from_source_at;
  new.pending_source := old.pending_source;
  new.sync_run_id := old.sync_run_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  if new.status is distinct from old.status then
    if not public.is_admin() then
      raise exception 'Only administrators can archive or restore sales records' using errcode = '42501';
    end if;
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := v_uid;
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  if old.status = 'archived' and new.status = 'archived' then
    raise exception 'Archived records are read-only. Restore the record first.' using errcode = '42501';
  end if;

  if old.source = 'google_sheets' and (
       new.sale_date, new.particulars, new.product_name, new.place_of_sale, new.manager, new.zone,
       new.doctor_name, new.hospital_name, new.voucher_no, new.quantity, new.quantity_unit,
       new.currency, new.rate, new.rate_unit, new.value, new.gross_total, new.gross_total_dc,
       new.export_sales, new.export_sales_dc, new.shipping_charges, new.shipping_charges_dc,
       new.inr_value
     ) is distinct from (
       old.sale_date, old.particulars, old.product_name, old.place_of_sale, old.manager, old.zone,
       old.doctor_name, old.hospital_name, old.voucher_no, old.quantity, old.quantity_unit,
       old.currency, old.rate, old.rate_unit, old.value, old.gross_total, old.gross_total_dc,
       old.export_sales, old.export_sales_dc, old.shipping_charges, old.shipping_charges_dc,
       old.inr_value
     ) then
    new.locally_modified := true;
  else
    new.locally_modified := old.locally_modified;
  end if;

  new.updated_at := now();
  new.updated_by := v_uid;
  return new;
end;
$$;

create or replace function public.npp_sales_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync boolean := coalesce(current_setting('app.npp_sync_run', true), '') <> '';
  v_changes jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
  v_col text;
  v_action text;
  v_cols text[] := array['sale_date','product_name','place_of_sale','manager','zone','doctor_name',
    'hospital_name','voucher_no','quantity','quantity_unit','currency','rate','rate_unit','value',
    'gross_total','gross_total_dc','export_sales','export_sales_dc','shipping_charges',
    'shipping_charges_dc','inr_value','remarks','status','data_issues','source_key'];
begin
  if tg_op = 'INSERT' then
    if v_sync then
      return new;
    end if;
    perform public.write_audit('sales.created', 'npp_sale', new.id::text, 'npp',
      'Sales record created (voucher ' || coalesce(new.voucher_no, '—') || ')',
      null, jsonb_build_object('voucher_no', new.voucher_no, 'product', new.product_name));
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_col in array v_cols loop
    if v_old -> v_col is distinct from v_new -> v_col then
      v_changes := v_changes || jsonb_build_object(v_col,
        jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col));
    end if;
  end loop;
  if old.particulars is distinct from new.particulars then
    v_changes := v_changes || jsonb_build_object('particulars', jsonb_build_object('changed', true));
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  v_action := case
    when v_sync then 'sales.sync_updated'
    when old.status = 'active' and new.status = 'archived' then 'sales.archived'
    when old.status = 'archived' and new.status = 'active' then 'sales.restored'
    else 'sales.updated' end;

  perform public.write_audit(v_action, 'npp_sale', new.id::text, 'npp',
    initcap(replace(split_part(v_action, '.', 2), '_', ' ')) || ' (voucher ' || coalesce(new.voucher_no, '—') || ')',
    v_changes,
    case when v_sync then jsonb_build_object('sync_run_id', current_setting('app.npp_sync_run', true))
         else '{}'::jsonb end);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Sales managers (master data)
-- ---------------------------------------------------------------------
create table public.sales_managers (
  manager_key       text primary key check (manager_key ~ '^[a-z0-9][a-z0-9 ()._-]{0,79}$'),
  display_name      text not null check (length(btrim(display_name)) between 1 and 80),
  aliases           text[] not null default '{}',   -- other spellings found in the sheet (lower case)
  employee_id       text check (employee_id is null or length(employee_id) <= 40),
  designation       text check (designation is null or length(designation) <= 80),
  zone              text check (zone is null or length(zone) <= 80),
  branch            text check (branch is null or length(branch) <= 80),
  reporting_manager text check (reporting_manager is null or length(reporting_manager) <= 80),
  -- false for HO and HO (Third Party): company channels, never ranked as individuals
  is_sales_manager  boolean not null default true,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null
);

create trigger sales_managers_touch before update on public.sales_managers
  for each row execute function public.touch_updated_at();

-- Resolve a sheet manager name to its master key (aliases included). Unknown names fall back
-- to their own lower-cased text so new managers still show up (flagged as "not in master data").
create or replace function public.npp_manager_key(p text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p, '')), '') is null then null else coalesce(
    (select m.manager_key from public.sales_managers m
      where m.manager_key = lower(regexp_replace(btrim(p), '\s+', ' ', 'g'))
         or lower(regexp_replace(btrim(p), '\s+', ' ', 'g')) = any (m.aliases)
      limit 1),
    lower(regexp_replace(btrim(p), '\s+', ' ', 'g'))) end;
$$;

-- ---------------------------------------------------------------------
-- 3. Sales targets — one row per scope / key / month
-- ---------------------------------------------------------------------
create table public.sales_targets (
  id            uuid primary key default gen_random_uuid(),
  department_code text not null default 'npp' references public.departments (code),
  scope         text not null check (scope in ('manager', 'zone', 'company')),
  scope_key     text not null check (length(scope_key) between 1 and 80),
  period_month  date not null check (extract(day from period_month) = 1),
  target_inr    numeric(16, 2) not null check (target_inr >= 0),
  notes         text check (notes is null or length(notes) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  updated_by    uuid references auth.users (id) on delete set null,
  constraint sales_targets_company_key check (scope <> 'company' or scope_key = 'company'),
  unique (department_code, scope, scope_key, period_month)
);

create index sales_targets_period_idx on public.sales_targets (department_code, period_month);

create or replace function public.sales_targets_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger sales_targets_stamp before insert or update on public.sales_targets
  for each row execute function public.sales_targets_stamp();

-- Shared audit trigger for master data and targets
create or replace function public.master_data_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_table_name;
  v_id text;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_changes jsonb := '{}'::jsonb;
  v_verb text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  k text;
begin
  v_id := coalesce(v_new, v_old) ->> case when tg_table_name = 'sales_managers' then 'manager_key' else 'id' end;
  for k in select jsonb_object_keys(coalesce(v_new, v_old)) loop
    continue when k in ('created_at', 'updated_at', 'created_by', 'updated_by');
    if (v_old -> k) is distinct from (v_new -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
    end if;
  end loop;
  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return new;
  end if;
  perform public.write_audit(
    case when tg_table_name = 'sales_targets' then 'targets.' else 'managers.' end ||
      v_verb,
    v_entity, v_id, 'npp',
    case when tg_table_name = 'sales_targets'
      then 'Target ' || v_verb || ': ' || (coalesce(v_new, v_old) ->> 'scope') || ' ' ||
           (coalesce(v_new, v_old) ->> 'scope_key') || ' ' || (coalesce(v_new, v_old) ->> 'period_month')
      else 'Sales manager ' || v_verb || ': ' || (coalesce(v_new, v_old) ->> 'display_name') end,
    v_changes);
  return coalesce(new, old);
end;
$$;

create trigger sales_managers_audit after insert or update or delete on public.sales_managers
  for each row execute function public.master_data_audit();
create trigger sales_targets_audit after insert or update or delete on public.sales_targets
  for each row execute function public.master_data_audit();

alter table public.sales_managers enable row level security;
alter table public.sales_targets enable row level security;

create policy sales_managers_read on public.sales_managers
  for select to authenticated using (public.has_department_access('npp'));
create policy sales_managers_admin_insert on public.sales_managers
  for insert to authenticated with check (public.is_admin());
create policy sales_managers_admin_update on public.sales_managers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sales_targets_read on public.sales_targets
  for select to authenticated using (public.has_department_access(department_code));
create policy sales_targets_admin_insert on public.sales_targets
  for insert to authenticated with check (public.is_admin());
create policy sales_targets_admin_update on public.sales_targets
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sales_targets_admin_delete on public.sales_targets
  for delete to authenticated using (public.is_admin());

revoke all on public.sales_managers, public.sales_targets from anon;
revoke delete on public.sales_managers from authenticated;

-- Seed managers from the names and zones stated in the NPM Sales sheet.
-- Branch / employee id / designation are not in the sheet and are left for an administrator.
insert into public.sales_managers (manager_key, display_name, aliases, zone, is_sales_manager) values
  ('firoz',            'Firoz',            '{}',         'North Zone', true),
  ('yatharth',         'Yatharth',         '{}',         'North Zone', true),
  ('iyappan',          'Iyappan',          '{}',         'South Zone', true),
  ('mujeeb',           'Mujeeb',           '{}',         'South Zone', true),
  ('fazan',            'Fazan',            '{faizan}',   'South Zone', true),
  ('mandar',           'Mandar',           '{}',         'West Zone',  true),
  ('ho',               'HO',               '{}',         null,         false),
  ('ho (third party)', 'HO (Third Party)', '{ho ( third party ),ho(third party),ho third party,ho (third party sales)}', null, false);

-- ---------------------------------------------------------------------
-- 4. Staged uploads (sheet snapshots and admin CSV uploads). Service role only.
-- ---------------------------------------------------------------------
create table public.npp_sheet_uploads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  origin          text not null check (origin in ('sheet_snapshot', 'csv_upload')),
  spreadsheet_id  text,
  sheet_gid       text,
  file_name       text,
  values          jsonb not null check (jsonb_typeof(values) = 'array'),
  expires_at      timestamptz not null default now() + interval '15 minutes',
  consumed_at     timestamptz,
  sync_run_id     uuid references public.sync_runs (id) on delete set null
);
alter table public.npp_sheet_uploads enable row level security;   -- no policies: service role only
revoke all on public.npp_sheet_uploads from anon, authenticated;

create or replace function public.npp_consume_upload(p_id uuid)
returns public.npp_sheet_uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.npp_sheet_uploads;
begin
  update public.npp_sheet_uploads
     set consumed_at = now()
   where id = p_id and consumed_at is null and expires_at > now()
  returning * into v;
  if not found then
    raise exception 'Upload not found, expired or already used' using errcode = 'P0002';
  end if;
  return v;
end;
$$;
revoke all on function public.npp_consume_upload(uuid) from public, anon, authenticated;
grant execute on function public.npp_consume_upload(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5. Field-aware sync with adoption of v1 records
-- ---------------------------------------------------------------------
create or replace function public.npp_sync_apply_v2(p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  f jsonb;
  v_existing public.npp_sales;
  v_issues text[];
  v_legacy text[] := array['missing_voucher','duplicate_voucher_in_sheet','missing_rate','currency_not_stated',
    'invalid_value','value_mismatch','rate_unit_mismatch','columns_shifted','export_sales_mismatch'];
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
  v_adopted int := 0;
  v_adopting boolean;
begin
  perform set_config('app.npp_sync_run', p_run_id::text, true);

  for r in select * from jsonb_array_elements(p_rows) loop
    f := coalesce(r -> 'fields', '[]'::jsonb);
    v_issues := coalesce(array(select jsonb_array_elements_text(r -> 'data_issues')), '{}');
    v_adopting := false;

    select * into v_existing from public.npp_sales where source_key = r ->> 'source_key' for update;

    if not found then
      -- Adopt a record imported from a different spreadsheet layout: same customer, product
      -- and INR value, same date (or no date on the old record), not yet claimed by this run.
      select * into v_existing from public.npp_sales s
       where s.source = 'google_sheets'
         and s.source_sheet_id is distinct from r ->> 'source_sheet_id'
         and s.sync_run_id is distinct from p_run_id
         and lower(btrim(s.particulars)) = lower(r ->> 'particulars')
         and lower(regexp_replace(btrim(s.product_name), '\s+', ' ', 'g'))
             = lower(regexp_replace(btrim(r ->> 'product_name'), '\s+', ' ', 'g'))
         and s.inr_value is not distinct from (r ->> 'inr_value')::numeric
         and (s.sale_date = (r ->> 'sale_date')::date or s.sale_date is null)
       order by (s.sale_date is null), s.source_row_number
       limit 1
       for update skip locked;
      v_adopting := found;
    end if;

    if v_existing.id is null then
      insert into public.npp_sales (
        source, source_key, source_sheet_id, source_gid, source_row_number, source_hash, source_raw,
        last_synced_at, sync_run_id, sale_date, particulars, product_name, place_of_sale, manager, zone,
        doctor_name, hospital_name, voucher_no, quantity, quantity_unit, currency, rate, rate_unit,
        value, gross_total, gross_total_dc, export_sales, export_sales_dc, shipping_charges,
        shipping_charges_dc, inr_value, data_issues)
      values (
        'google_sheets', r ->> 'source_key', r ->> 'source_sheet_id', r ->> 'source_gid',
        (r ->> 'source_row_number')::int, r ->> 'source_hash', r -> 'source_raw',
        now(), p_run_id, (r ->> 'sale_date')::date, r ->> 'particulars', r ->> 'product_name',
        r ->> 'place_of_sale', r ->> 'manager', r ->> 'zone', r ->> 'doctor_name', r ->> 'hospital_name',
        r ->> 'voucher_no', (r ->> 'quantity')::numeric, r ->> 'quantity_unit', r ->> 'currency',
        (r ->> 'rate')::numeric, r ->> 'rate_unit', (r ->> 'value')::numeric,
        (r ->> 'gross_total')::numeric, r ->> 'gross_total_dc', (r ->> 'export_sales')::numeric,
        r ->> 'export_sales_dc', (r ->> 'shipping_charges')::numeric, r ->> 'shipping_charges_dc',
        (r ->> 'inr_value')::numeric, v_issues);
      v_inserted := v_inserted + 1;
      v_existing := null;
      continue;
    end if;

    if not v_adopting and v_existing.source_hash = r ->> 'source_hash' then
      update public.npp_sales
         set last_synced_at = now(), missing_from_source_at = null, sync_run_id = p_run_id,
             source_row_number = (r ->> 'source_row_number')::int
       where id = v_existing.id;
      v_unchanged := v_unchanged + 1;

    elsif v_existing.locally_modified or v_existing.status = 'archived' then
      -- Never overwrite CRM edits. When adopting, the record is re-keyed so later syncs match it.
      update public.npp_sales
         set pending_source = r, last_synced_at = now(), missing_from_source_at = null,
             sync_run_id = p_run_id,
             source_key = r ->> 'source_key', source_sheet_id = r ->> 'source_sheet_id',
             source_gid = r ->> 'source_gid', source_row_number = (r ->> 'source_row_number')::int
       where id = v_existing.id;
      if v_existing.pending_source is null or v_existing.pending_source ->> 'source_hash' is distinct from r ->> 'source_hash' then
        perform public.write_audit('sales.sync_conflict', 'npp_sale', v_existing.id::text, 'npp',
          'Sheet changed a record that was edited in the CRM', null, jsonb_build_object('sync_run_id', p_run_id));
      end if;
      v_conflicts := v_conflicts + 1;
      if v_adopting then v_adopted := v_adopted + 1; end if;

    else
      -- Columns the current sheet does not carry are kept; their legacy data-quality flags too.
      if not (f ? 'voucher_no') then
        v_issues := array(select distinct unnest(v_issues ||
          array(select i from unnest(v_existing.data_issues) i where i = any (v_legacy))));
      end if;
      update public.npp_sales set
        source_key = r ->> 'source_key',
        source_sheet_id = r ->> 'source_sheet_id', source_gid = r ->> 'source_gid',
        source_row_number = (r ->> 'source_row_number')::int, source_hash = r ->> 'source_hash',
        source_raw = r -> 'source_raw', last_synced_at = now(), missing_from_source_at = null,
        sync_run_id = p_run_id, pending_source = null,
        sale_date      = case when f ? 'sale_date'      then (r ->> 'sale_date')::date else sale_date end,
        particulars    = r ->> 'particulars',
        product_name   = r ->> 'product_name',
        place_of_sale  = case when f ? 'place_of_sale'  then r ->> 'place_of_sale' else place_of_sale end,
        manager        = case when f ? 'manager'        then r ->> 'manager' else manager end,
        zone           = case when f ? 'zone'           then r ->> 'zone' else zone end,
        doctor_name    = case when f ? 'doctor_name'    then r ->> 'doctor_name' else doctor_name end,
        hospital_name  = case when f ? 'hospital_name'  then r ->> 'hospital_name' else hospital_name end,
        voucher_no     = case when f ? 'voucher_no'     then r ->> 'voucher_no' else voucher_no end,
        quantity       = case when f ? 'quantity'       then (r ->> 'quantity')::numeric else quantity end,
        quantity_unit  = case when f ? 'quantity_unit'  then r ->> 'quantity_unit' else quantity_unit end,
        currency       = case when f ? 'currency'       then r ->> 'currency' else currency end,
        rate           = case when f ? 'rate'           then (r ->> 'rate')::numeric else rate end,
        rate_unit      = case when f ? 'rate_unit'      then r ->> 'rate_unit' else rate_unit end,
        value          = case when f ? 'value'          then (r ->> 'value')::numeric else value end,
        gross_total    = case when f ? 'gross_total'    then (r ->> 'gross_total')::numeric else gross_total end,
        gross_total_dc = case when f ? 'gross_total_dc' then r ->> 'gross_total_dc' else gross_total_dc end,
        export_sales   = case when f ? 'export_sales'   then (r ->> 'export_sales')::numeric else export_sales end,
        export_sales_dc = case when f ? 'export_sales_dc' then r ->> 'export_sales_dc' else export_sales_dc end,
        shipping_charges = case when f ? 'shipping_charges' then (r ->> 'shipping_charges')::numeric else shipping_charges end,
        shipping_charges_dc = case when f ? 'shipping_charges_dc' then r ->> 'shipping_charges_dc' else shipping_charges_dc end,
        inr_value      = (r ->> 'inr_value')::numeric,
        data_issues    = v_issues
      where id = v_existing.id;
      if v_adopting then v_adopted := v_adopted + 1; else v_updated := v_updated + 1; end if;
    end if;
    v_existing := null;
  end loop;

  update public.sync_runs
     set inserted = inserted + v_inserted, updated = updated + v_updated,
         unchanged = unchanged + v_unchanged, conflicts = conflicts + v_conflicts,
         adopted = adopted + v_adopted
   where id = p_run_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
                            'conflicts', v_conflicts, 'adopted', v_adopted);
end;
$$;

revoke all on function public.npp_sync_apply_v2(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.npp_sync_apply_v2(uuid, jsonb) to service_role;

-- Accepting a parked sheet version must also bring the zone across
create or replace function public.npp_resolve_conflict(p_id uuid, p_resolution text)
returns public.npp_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.npp_sales;
  r jsonb;
  f jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can resolve synchronisation conflicts' using errcode = '42501';
  end if;
  select * into v_row from public.npp_sales where id = p_id for update;
  if not found or v_row.pending_source is null then
    raise exception 'No pending sheet version for this record' using errcode = 'P0002';
  end if;
  r := v_row.pending_source;
  -- v1 payloads have no field list: they carried every column
  f := coalesce(r -> 'fields', '["sale_date","place_of_sale","manager","doctor_name","hospital_name","voucher_no","quantity","quantity_unit","currency","rate","rate_unit","value","gross_total","gross_total_dc","export_sales","export_sales_dc","shipping_charges","shipping_charges_dc"]'::jsonb);

  perform set_config('app.npp_sync_run', 'conflict-resolution', true);

  if p_resolution = 'accept_source' then
    update public.npp_sales set
      source_hash = r ->> 'source_hash', source_raw = r -> 'source_raw',
      sale_date      = case when f ? 'sale_date'      then (r ->> 'sale_date')::date else sale_date end,
      particulars    = r ->> 'particulars',
      product_name   = r ->> 'product_name',
      place_of_sale  = case when f ? 'place_of_sale'  then r ->> 'place_of_sale' else place_of_sale end,
      manager        = case when f ? 'manager'        then r ->> 'manager' else manager end,
      zone           = case when f ? 'zone'           then r ->> 'zone' else zone end,
      doctor_name    = case when f ? 'doctor_name'    then r ->> 'doctor_name' else doctor_name end,
      hospital_name  = case when f ? 'hospital_name'  then r ->> 'hospital_name' else hospital_name end,
      voucher_no     = case when f ? 'voucher_no'     then r ->> 'voucher_no' else voucher_no end,
      quantity       = case when f ? 'quantity'       then (r ->> 'quantity')::numeric else quantity end,
      quantity_unit  = case when f ? 'quantity_unit'  then r ->> 'quantity_unit' else quantity_unit end,
      currency       = case when f ? 'currency'       then r ->> 'currency' else currency end,
      rate           = case when f ? 'rate'           then (r ->> 'rate')::numeric else rate end,
      rate_unit      = case when f ? 'rate_unit'      then r ->> 'rate_unit' else rate_unit end,
      value          = case when f ? 'value'          then (r ->> 'value')::numeric else value end,
      gross_total    = case when f ? 'gross_total'    then (r ->> 'gross_total')::numeric else gross_total end,
      gross_total_dc = case when f ? 'gross_total_dc' then r ->> 'gross_total_dc' else gross_total_dc end,
      export_sales   = case when f ? 'export_sales'   then (r ->> 'export_sales')::numeric else export_sales end,
      export_sales_dc = case when f ? 'export_sales_dc' then r ->> 'export_sales_dc' else export_sales_dc end,
      shipping_charges = case when f ? 'shipping_charges' then (r ->> 'shipping_charges')::numeric else shipping_charges end,
      shipping_charges_dc = case when f ? 'shipping_charges_dc' then r ->> 'shipping_charges_dc' else shipping_charges_dc end,
      inr_value = (r ->> 'inr_value')::numeric,
      data_issues = coalesce(array(select jsonb_array_elements_text(r -> 'data_issues')), '{}'),
      pending_source = null, locally_modified = false, updated_by = auth.uid()
    where id = p_id returning * into v_row;
  elsif p_resolution = 'keep_crm' then
    update public.npp_sales
       set pending_source = null, source_hash = r ->> 'source_hash', source_raw = r -> 'source_raw',
           updated_by = auth.uid()
     where id = p_id returning * into v_row;
  else
    raise exception 'Resolution must be accept_source or keep_crm' using errcode = '22023';
  end if;

  perform public.write_audit('sales.conflict_resolved', 'npp_sale', p_id::text, 'npp',
    'Sync conflict resolved: ' || p_resolution || ' (voucher ' || coalesce(v_row.voucher_no, '—') || ')');
  return v_row;
end;
$$;

revoke all on function public.npp_resolve_conflict(uuid, text) from public, anon;
grant execute on function public.npp_resolve_conflict(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Analytics: zone / channel filters; rows missing from the current
--    source are excluded unless include_missing is set.
-- ---------------------------------------------------------------------
create or replace function public.npp_filtered(p jsonb default '{}'::jsonb)
returns setof public.npp_sales
language sql
stable
security invoker
set search_path = ''
as $$
  select s.*
  from public.npp_sales s
  where (coalesce((p ->> 'include_archived')::boolean, false) or s.status = 'active')
    and (coalesce((p ->> 'include_missing')::boolean, false) or s.missing_from_source_at is null)
    and (p ->> 'date_from' is null or s.sale_date >= (p ->> 'date_from')::date)
    and (p ->> 'date_to'   is null or s.sale_date <= (p ->> 'date_to')::date)
    and (p ->> 'product'   is null or public.npp_label(s.product_name)  = p ->> 'product')
    and (p ->> 'manager'   is null or public.npp_label(s.manager)       = p ->> 'manager')
    and (p ->> 'manager_key' is null or public.npp_manager_key(s.manager) = p ->> 'manager_key')
    and (p ->> 'zone'      is null or s.zone_base = p ->> 'zone')
    and (p ->> 'channel'   is null or s.channel = p ->> 'channel')
    and (p ->> 'hospital'  is null or public.npp_label(s.hospital_name) = p ->> 'hospital')
    and (p ->> 'doctor'    is null or public.npp_label(s.doctor_name)   = p ->> 'doctor')
    and (p ->> 'place'     is null or public.npp_label(s.place_of_sale) = p ->> 'place')
    and (p ->> 'voucher'   is null or s.voucher_no ilike '%' || (p ->> 'voucher') || '%')
    and (p ->> 'currency'  is null
         or (p ->> 'currency' = 'UNSPECIFIED' and s.currency is null)
         or s.currency = p ->> 'currency')
    and (p ->> 'needs_review' is null or s.needs_review = (p ->> 'needs_review')::boolean)
    and (p ->> 'search' is null or (
         s.particulars ilike '%' || (p ->> 'search') || '%'
      or s.product_name ilike '%' || (p ->> 'search') || '%'
      or s.doctor_name ilike '%' || (p ->> 'search') || '%'
      or s.hospital_name ilike '%' || (p ->> 'search') || '%'
      or s.manager ilike '%' || (p ->> 'search') || '%'
      or s.zone ilike '%' || (p ->> 'search') || '%'
      or s.voucher_no ilike '%' || (p ->> 'search') || '%'));
$$;

create or replace function public.npp_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with a as (select * from public.npp_sales where status = 'active' and missing_from_source_at is null)
  select jsonb_build_object(
    'products',  coalesce((select jsonb_agg(distinct public.npp_label(product_name))  from a where product_name is not null), '[]'),
    'managers',  coalesce((select jsonb_agg(distinct public.npp_label(manager))       from a where nullif(trim(manager), '') is not null), '[]'),
    'hospitals', coalesce((select jsonb_agg(distinct public.npp_label(hospital_name)) from a where nullif(trim(hospital_name), '') is not null), '[]'),
    'doctors',   coalesce((select jsonb_agg(distinct public.npp_label(doctor_name))   from a where nullif(trim(doctor_name), '') is not null), '[]'),
    'places',    coalesce((select jsonb_agg(distinct public.npp_label(place_of_sale)) from a where nullif(trim(place_of_sale), '') is not null), '[]'),
    'zones',     coalesce((select jsonb_agg(distinct zone_base) from a where zone_base is not null), '[]'),
    'financial_years', coalesce((select jsonb_agg(distinct public.npp_fy(sale_date)) from a where sale_date is not null), '[]'),
    'currencies', coalesce((select jsonb_agg(distinct coalesce(currency, 'UNSPECIFIED')) from a), '[]')
  );
$$;

-- Monthly performance facts + targets + master data in one payload. Aggregation of statuses,
-- pacing, consolidation and ranking happens in the typed client module (unit tested).
create or replace function public.npp_performance(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (select * from public.npp_filtered(p)),
  facts as (
    select to_char(date_trunc('month', sale_date), 'YYYY-MM-DD') as month,
           public.npp_manager_key(manager) as manager_key,
           coalesce(public.npp_label(manager), 'Not stated') as manager_label,
           zone_base as zone,
           (zone ~* '^\s*HO\s') as ho_zone,
           channel,
           public.npp_label(place_of_sale) as place,
           count(*) as records,
           sum(inr_value) as inr,
           count(*) filter (where inr_value is null) as missing_inr,
           count(*) filter (where 'possible_duplicate_attribution' = any (data_issues)) as dup_flags,
           max(sale_date) as last_sale
      from f
     where sale_date is not null
     group by 1, 2, 3, 4, 5, 6, 7
  )
  select jsonb_build_object(
    'facts', coalesce((select jsonb_agg(to_jsonb(facts) order by month, manager_key) from facts), '[]'::jsonb),
    'undated', (select jsonb_build_object('records', count(*), 'inr', coalesce(sum(inr_value), 0))
                  from f where sale_date is null),
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
                  'scope', scope, 'scope_key', scope_key, 'month', to_char(period_month, 'YYYY-MM-DD'),
                  'target', target_inr) order by period_month)
                from public.sales_targets where department_code = 'npp'), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(to_jsonb(m) - 'updated_by' order by m.display_name)
                from public.sales_managers m), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from public.app_settings
                where key in ('targets.pacing', 'reporting.consolidation', 'reporting.financial_year_start_month')), '{}'::jsonb),
    'last_sync', (select to_jsonb(r) - 'errors' from public.sync_runs r
                   where department_code = 'npp' and status in ('succeeded', 'partial')
                   order by started_at desc limit 1),
    'generated_at', now()
  );
$$;

revoke all on function public.npp_performance(jsonb) from public, anon;
grant execute on function public.npp_performance(jsonb) to authenticated;
revoke all on function public.npp_manager_key(text) from public, anon;
grant execute on function public.npp_manager_key(text) to authenticated;

revoke all on function public.sales_targets_stamp() from public, anon, authenticated;
revoke all on function public.master_data_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Configuration
-- ---------------------------------------------------------------------
update public.departments
   set config = config || jsonb_build_object(
         'spreadsheet_id', '1X1oWDT1p6fyFwVCW9xEPkegOJ4ztBL82ANoCYWdvxq0',
         'sheet_gid', 631975196,
         'sheet_title', 'Sheet1',
         'header_row', 1,
         'mapping_version', 2,
         'previous_spreadsheet_id', config ->> 'spreadsheet_id')
 where code = 'npp';

insert into public.app_settings (key, value, is_public, description) values
  ('targets.pacing', '"linear"'::jsonb, true,
     'Expected-to-date target for the current month = monthly target × elapsed days ÷ days in month.'),
  ('reporting.consolidation', jsonb_build_object(
     'ho_zone_rollup', true,
     'third_party_bucket', 'company',
     'branches', jsonb_build_array(jsonb_build_object(
        'name', 'Bangalore',
        'zone', 'South Zone',
        'places', jsonb_build_array('Bangalore', 'Bengaluru'),
        'channels', jsonb_build_array('ho', 'individual'),
        'description', 'Consolidated Bangalore = HO sales with place of sale Bangalore + individual managers'' sales with place of sale Bangalore. Each sheet row is counted once; rows flagged as a possible duplicate attribution are listed for review and never silently merged.'))), true,
     'Zone and branch consolidation rules used by the performance dashboards.')
on conflict (key) do nothing;
