-- =====================================================================
-- Migration 2: NPP sales table, guards, audit trail and sync functions
-- =====================================================================

create table public.npp_sales (
  id                  uuid primary key default gen_random_uuid(),

  -- Provenance ---------------------------------------------------------
  source              text not null default 'manual' check (source in ('google_sheets', 'manual')),
  source_key          text unique,            -- stable key (normalised voucher no.) for sheet rows
  source_sheet_id     text,
  source_gid          text,
  source_row_number   int,                    -- informational only; rows can move
  source_hash         text,                   -- hash of the raw row, for change detection
  source_raw          jsonb,                  -- original cell text, kept for reconciliation
  last_synced_at      timestamptz,
  missing_from_source_at timestamptz,         -- set when the row disappears from the sheet (never auto-deleted)
  locally_modified    boolean not null default false,  -- edited in the CRM after import
  pending_source      jsonb,                  -- newer sheet version held back because of a local edit
  sync_run_id         uuid references public.sync_runs (id) on delete set null,

  -- Business fields (mirroring the NPP sheet) ------------------------------
  sale_date           date,
  particulars         text not null check (length(trim(particulars)) between 1 and 200),
  product_name        text not null check (length(trim(product_name)) between 1 and 200),
  place_of_sale       text check (place_of_sale is null or length(place_of_sale) <= 120),
  manager             text check (manager is null or length(manager) <= 120),
  doctor_name         text check (doctor_name is null or length(doctor_name) <= 160),
  hospital_name       text check (hospital_name is null or length(hospital_name) <= 200),
  voucher_no          text check (voucher_no is null or length(voucher_no) <= 60),
  quantity            numeric(14, 3) check (quantity is null or quantity > 0),
  quantity_unit       text check (quantity_unit is null or quantity_unit ~ '^[A-Z]{1,12}$'),
  currency            text check (currency is null or currency in ('USD', 'EUR', 'GBP', 'INR')),
  rate                numeric(14, 2) check (rate is null or rate >= 0),
  rate_unit           text check (rate_unit is null or rate_unit ~ '^[A-Z]{1,12}$'),
  value               numeric(14, 2) check (value is null or value >= 0),
  gross_total         numeric(14, 2) check (gross_total is null or gross_total >= 0),
  gross_total_dc      text check (gross_total_dc is null or gross_total_dc in ('Dr', 'Cr')),
  export_sales        numeric(14, 2) check (export_sales is null or export_sales >= 0),
  export_sales_dc     text check (export_sales_dc is null or export_sales_dc in ('Dr', 'Cr')),
  shipping_charges    numeric(14, 2) check (shipping_charges is null or shipping_charges >= 0),
  shipping_charges_dc text check (shipping_charges_dc is null or shipping_charges_dc in ('Dr', 'Cr')),
  inr_value           numeric(16, 2) check (inr_value is null or inr_value >= 0),
  remarks             text check (remarks is null or length(remarks) <= 1000),

  -- Data quality -----------------------------------------------------------
  data_issues         text[] not null default '{}',
  needs_review        boolean generated always as (cardinality(data_issues) > 0) stored,

  -- Lifecycle --------------------------------------------------------------
  status              text not null default 'active' check (status in ('active', 'archived')),
  archived_at         timestamptz,
  archived_by         uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,

  constraint sheet_rows_have_key check (source <> 'google_sheets' or source_key is not null),
  constraint manual_rows_have_date check (source <> 'manual' or sale_date is not null)
);

create index npp_sales_date_idx      on public.npp_sales (sale_date desc nulls last);
create index npp_sales_voucher_idx   on public.npp_sales (lower(voucher_no));
create index npp_sales_product_idx   on public.npp_sales (lower(product_name));
create index npp_sales_manager_idx   on public.npp_sales (lower(manager));
create index npp_sales_hospital_idx  on public.npp_sales (lower(hospital_name));
create index npp_sales_status_idx    on public.npp_sales (status);
create index npp_sales_review_idx    on public.npp_sales (needs_review) where needs_review;

-- ---------------------------------------------------------------------
-- Guard trigger: enforces provenance and permission rules regardless of
-- what the client sends.
-- ---------------------------------------------------------------------
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

  -- UPDATE by a user: provenance columns are immutable
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
       new.sale_date, new.particulars, new.product_name, new.place_of_sale, new.manager,
       new.doctor_name, new.hospital_name, new.voucher_no, new.quantity, new.quantity_unit,
       new.currency, new.rate, new.rate_unit, new.value, new.gross_total, new.gross_total_dc,
       new.export_sales, new.export_sales_dc, new.shipping_charges, new.shipping_charges_dc,
       new.inr_value
     ) is distinct from (
       old.sale_date, old.particulars, old.product_name, old.place_of_sale, old.manager,
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

create trigger npp_sales_guard
  before insert or update on public.npp_sales
  for each row execute function public.npp_sales_guard();

-- ---------------------------------------------------------------------
-- Audit trigger. Patient names (particulars) are never written to the
-- audit log; only the fact that the field changed.
-- ---------------------------------------------------------------------
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
  v_cols text[] := array['sale_date','product_name','place_of_sale','manager','doctor_name',
    'hospital_name','voucher_no','quantity','quantity_unit','currency','rate','rate_unit','value',
    'gross_total','gross_total_dc','export_sales','export_sales_dc','shipping_charges',
    'shipping_charges_dc','inr_value','remarks','status','data_issues'];
begin
  if tg_op = 'INSERT' then
    if v_sync then
      return new;   -- imports are summarised once per sync run
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

create trigger npp_sales_audit
  after insert or update on public.npp_sales
  for each row execute function public.npp_sales_audit();

-- Hard deletes are not allowed (archive instead)
create or replace function public.npp_sales_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Sales records cannot be deleted. Archive them instead.' using errcode = '42501';
end;
$$;

create trigger npp_sales_no_delete before delete on public.npp_sales
  for each row execute function public.npp_sales_no_delete();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.npp_sales enable row level security;

create policy npp_sales_read on public.npp_sales
  for select to authenticated using (public.has_department_access('npp'));

create policy npp_sales_insert on public.npp_sales
  for insert to authenticated with check (public.has_department_access('npp'));

create policy npp_sales_update on public.npp_sales
  for update to authenticated
  using (public.has_department_access('npp'))
  with check (public.has_department_access('npp'));

revoke all on public.npp_sales from anon;
revoke delete on public.npp_sales from authenticated;

-- ---------------------------------------------------------------------
-- Sync functions (service role only — called by the sheets-sync Edge
-- Function, never by the browser).
--
-- Policy: Google Sheets is authoritative for rows it supplied, UNLESS the
-- row was edited in the CRM (locally_modified). In that case the incoming
-- sheet version is parked in pending_source and counted as a conflict for
-- an administrator to resolve. Rows missing from the sheet are flagged,
-- never deleted.
-- ---------------------------------------------------------------------
create or replace function public.npp_sync_start(
  p_trigger text,
  p_sheet_id text,
  p_range text,
  p_initiated_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.sync_runs
              where department_code = 'npp' and status = 'running'
                and started_at > now() - interval '10 minutes') then
    raise exception 'A synchronisation is already running' using errcode = '55P03';
  end if;
  insert into public.sync_runs (department_code, source_sheet_id, source_range, trigger, initiated_by)
  values ('npp', p_sheet_id, p_range, p_trigger, p_initiated_by)
  returning id into v_id;
  perform public.write_audit('sync.started', 'sync_run', v_id::text, 'npp',
    'Google Sheets synchronisation started (' || p_trigger || ')', null,
    jsonb_build_object('initiated_by', p_initiated_by));
  return v_id;
end;
$$;

create or replace function public.npp_sync_apply(p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_existing public.npp_sales;
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
begin
  perform set_config('app.npp_sync_run', p_run_id::text, true);

  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_existing from public.npp_sales where source_key = r ->> 'source_key' for update;

    if not found then
      insert into public.npp_sales (
        source, source_key, source_sheet_id, source_gid, source_row_number, source_hash, source_raw,
        last_synced_at, sync_run_id, sale_date, particulars, product_name, place_of_sale, manager,
        doctor_name, hospital_name, voucher_no, quantity, quantity_unit, currency, rate, rate_unit,
        value, gross_total, gross_total_dc, export_sales, export_sales_dc, shipping_charges,
        shipping_charges_dc, inr_value, data_issues)
      values (
        'google_sheets', r ->> 'source_key', r ->> 'source_sheet_id', r ->> 'source_gid',
        (r ->> 'source_row_number')::int, r ->> 'source_hash', r -> 'source_raw',
        now(), p_run_id, (r ->> 'sale_date')::date, r ->> 'particulars', r ->> 'product_name',
        r ->> 'place_of_sale', r ->> 'manager', r ->> 'doctor_name', r ->> 'hospital_name',
        r ->> 'voucher_no', (r ->> 'quantity')::numeric, r ->> 'quantity_unit', r ->> 'currency',
        (r ->> 'rate')::numeric, r ->> 'rate_unit', (r ->> 'value')::numeric,
        (r ->> 'gross_total')::numeric, r ->> 'gross_total_dc', (r ->> 'export_sales')::numeric,
        r ->> 'export_sales_dc', (r ->> 'shipping_charges')::numeric, r ->> 'shipping_charges_dc',
        (r ->> 'inr_value')::numeric,
        coalesce(array(select jsonb_array_elements_text(r -> 'data_issues')), '{}'));
      v_inserted := v_inserted + 1;

    elsif v_existing.source_hash = r ->> 'source_hash' then
      update public.npp_sales
         set last_synced_at = now(), missing_from_source_at = null,
             source_row_number = (r ->> 'source_row_number')::int
       where id = v_existing.id;
      v_unchanged := v_unchanged + 1;

    elsif v_existing.locally_modified or v_existing.status = 'archived' then
      update public.npp_sales
         set pending_source = r, last_synced_at = now(), missing_from_source_at = null,
             source_row_number = (r ->> 'source_row_number')::int
       where id = v_existing.id;
      if v_existing.pending_source is null or v_existing.pending_source ->> 'source_hash' is distinct from r ->> 'source_hash' then
        perform public.write_audit('sales.sync_conflict', 'npp_sale', v_existing.id::text, 'npp',
          'Sheet changed a record that was edited in the CRM (voucher ' || coalesce(v_existing.voucher_no, '—') || ')',
          null, jsonb_build_object('sync_run_id', p_run_id));
      end if;
      v_conflicts := v_conflicts + 1;

    else
      update public.npp_sales set
        source_sheet_id = r ->> 'source_sheet_id', source_gid = r ->> 'source_gid',
        source_row_number = (r ->> 'source_row_number')::int, source_hash = r ->> 'source_hash',
        source_raw = r -> 'source_raw', last_synced_at = now(), missing_from_source_at = null,
        sync_run_id = p_run_id, pending_source = null,
        sale_date = (r ->> 'sale_date')::date, particulars = r ->> 'particulars',
        product_name = r ->> 'product_name', place_of_sale = r ->> 'place_of_sale',
        manager = r ->> 'manager', doctor_name = r ->> 'doctor_name',
        hospital_name = r ->> 'hospital_name', voucher_no = r ->> 'voucher_no',
        quantity = (r ->> 'quantity')::numeric, quantity_unit = r ->> 'quantity_unit',
        currency = r ->> 'currency', rate = (r ->> 'rate')::numeric, rate_unit = r ->> 'rate_unit',
        value = (r ->> 'value')::numeric, gross_total = (r ->> 'gross_total')::numeric,
        gross_total_dc = r ->> 'gross_total_dc', export_sales = (r ->> 'export_sales')::numeric,
        export_sales_dc = r ->> 'export_sales_dc', shipping_charges = (r ->> 'shipping_charges')::numeric,
        shipping_charges_dc = r ->> 'shipping_charges_dc', inr_value = (r ->> 'inr_value')::numeric,
        data_issues = coalesce(array(select jsonb_array_elements_text(r -> 'data_issues')), '{}')
      where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  update public.sync_runs
     set inserted = inserted + v_inserted, updated = updated + v_updated,
         unchanged = unchanged + v_unchanged, conflicts = conflicts + v_conflicts
   where id = p_run_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated,
                            'unchanged', v_unchanged, 'conflicts', v_conflicts);
end;
$$;

create or replace function public.npp_sync_finish(
  p_run_id uuid,
  p_seen_keys text[],
  p_rows_read int,
  p_rows_skipped int,
  p_invalid int,
  p_flagged int,
  p_errors jsonb,
  p_fatal_error text default null
)
returns public.sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing int := 0;
  v_run public.sync_runs;
begin
  perform set_config('app.npp_sync_run', p_run_id::text, true);

  if p_fatal_error is null and p_seen_keys is not null then
    update public.npp_sales
       set missing_from_source_at = coalesce(missing_from_source_at, now())
     where source = 'google_sheets' and status = 'active'
       and not (source_key = any (p_seen_keys));
    get diagnostics v_missing = row_count;
  end if;

  update public.sync_runs
     set finished_at = now(),
         rows_read = p_rows_read,
         rows_skipped = p_rows_skipped,
         invalid = p_invalid,
         flagged = p_flagged,
         missing_from_source = v_missing,
         errors = coalesce(p_errors, '[]'::jsonb),
         notes = p_fatal_error,
         status = case
           when p_fatal_error is not null then 'failed'
           when p_invalid > 0 then 'partial'
           else 'succeeded' end
   where id = p_run_id
  returning * into v_run;

  perform public.write_audit(
    case when v_run.status = 'failed' then 'sync.failed' else 'sync.completed' end,
    'sync_run', p_run_id::text, 'npp',
    'Google Sheets synchronisation ' || v_run.status,
    null,
    jsonb_build_object('inserted', v_run.inserted, 'updated', v_run.updated,
      'unchanged', v_run.unchanged, 'conflicts', v_run.conflicts, 'invalid', v_run.invalid,
      'missing_from_source', v_run.missing_from_source, 'error', p_fatal_error));

  return v_run;
end;
$$;

revoke all on function public.npp_sync_start(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.npp_sync_apply(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.npp_sync_finish(uuid, text[], int, int, int, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.npp_sync_start(text, text, text, uuid) to service_role;
grant execute on function public.npp_sync_apply(uuid, jsonb) to service_role;
grant execute on function public.npp_sync_finish(uuid, text[], int, int, int, int, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- Conflict resolution (admin): accept the parked sheet version, or keep
-- the CRM version and discard it.
-- ---------------------------------------------------------------------
create or replace function public.npp_resolve_conflict(p_id uuid, p_resolution text)
returns public.npp_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.npp_sales;
  r jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can resolve synchronisation conflicts' using errcode = '42501';
  end if;
  select * into v_row from public.npp_sales where id = p_id for update;
  if not found or v_row.pending_source is null then
    raise exception 'No pending sheet version for this record' using errcode = 'P0002';
  end if;
  r := v_row.pending_source;

  perform set_config('app.npp_sync_run', 'conflict-resolution', true);

  if p_resolution = 'accept_source' then
    update public.npp_sales set
      source_hash = r ->> 'source_hash', source_raw = r -> 'source_raw',
      sale_date = (r ->> 'sale_date')::date, particulars = r ->> 'particulars',
      product_name = r ->> 'product_name', place_of_sale = r ->> 'place_of_sale',
      manager = r ->> 'manager', doctor_name = r ->> 'doctor_name',
      hospital_name = r ->> 'hospital_name', voucher_no = r ->> 'voucher_no',
      quantity = (r ->> 'quantity')::numeric, quantity_unit = r ->> 'quantity_unit',
      currency = r ->> 'currency', rate = (r ->> 'rate')::numeric, rate_unit = r ->> 'rate_unit',
      value = (r ->> 'value')::numeric, gross_total = (r ->> 'gross_total')::numeric,
      gross_total_dc = r ->> 'gross_total_dc', export_sales = (r ->> 'export_sales')::numeric,
      export_sales_dc = r ->> 'export_sales_dc', shipping_charges = (r ->> 'shipping_charges')::numeric,
      shipping_charges_dc = r ->> 'shipping_charges_dc', inr_value = (r ->> 'inr_value')::numeric,
      data_issues = coalesce(array(select jsonb_array_elements_text(r -> 'data_issues')), '{}'),
      pending_source = null, locally_modified = false, updated_by = auth.uid()
    where id = p_id returning * into v_row;
  elsif p_resolution = 'keep_crm' then
    -- Keep CRM values; remember the sheet hash so this version is not raised again
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
