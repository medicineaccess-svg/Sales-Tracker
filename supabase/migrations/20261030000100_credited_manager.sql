-- =====================================================================
-- Migration 7: HO rows now name the manager they are credited to inside the
-- Zone cell, e.g. "HO North Zone (Firoz)" (sheet tab "2025-26").
--
--  * zone_base         "HO North Zone (Firoz)" → "North Zone"
--  * credited_manager  individual rows → the "Ikris Manager Involved" name;
--                      HO rows        → the name in brackets in Zone;
--                      HO (Third Party) / unnamed HO → NULL (company bucket)
-- Every sheet row has exactly one credited manager (or none), so
-- Manager → HO → Zone → transaction totals can never double count.
-- =====================================================================

drop index if exists public.npp_sales_zone_idx;
alter table public.npp_sales drop column zone_base;

alter table public.npp_sales
  add column zone_base text generated always as (
    nullif(btrim(regexp_replace(
      regexp_replace(regexp_replace(coalesce(zone, ''), '\s+', ' ', 'g'), '\(.*\)', '', 'g'),
      '^\s*HO\s+', '', 'i')), '')
  ) stored;

alter table public.npp_sales
  add column credited_manager text generated always as (
    case
      when manager is null or btrim(manager) = '' then null
      when manager ~* '^\s*HO\s*\(?\s*third\s*party' then null
      when manager ~* '^\s*HO\s*$' then nullif(btrim(substring(coalesce(zone, '') from '\(([^)]*)\)')), '')
      else btrim(regexp_replace(manager, '\s+', ' ', 'g'))
    end
  ) stored;

create index npp_sales_zone_idx on public.npp_sales (zone_base);
create index npp_sales_credited_idx on public.npp_sales (lower(credited_manager));

-- Filters: `owner` = credited manager key (own + HO sales), plus the existing ones
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
    and (p ->> 'owner'     is null or public.npp_manager_key(s.credited_manager) = p ->> 'owner')
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
           coalesce((select m.display_name from public.sales_managers m where m.manager_key = public.npp_manager_key(f.manager)),
                    public.npp_label(manager), 'Not stated') as manager_label,
           public.npp_manager_key(credited_manager) as owner_key,
           coalesce((select m.display_name from public.sales_managers m where m.manager_key = public.npp_manager_key(f.credited_manager)),
                    public.npp_label(credited_manager)) as owner_label,
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
     group by 1, 2, 3, 4, 5, 6, 7, 8, 9
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

update public.departments
   set config = config || jsonb_build_object('sheet_title', '2025-26')
 where code = 'npp';
