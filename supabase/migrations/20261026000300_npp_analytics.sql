-- =====================================================================
-- Migration 3: NPP analytics. All functions are SECURITY INVOKER so the
-- caller's RLS policies apply — department users only ever aggregate
-- rows they are allowed to read.
--
-- Filter object (all keys optional):
--   date_from, date_to   'YYYY-MM-DD'  (undated rows are excluded when either is set)
--   product, manager, hospital, doctor, place   exact match on the grouping label
--   voucher              substring match
--   search               substring match across text fields
--   currency             'USD' | 'EUR' | 'GBP' | 'INR' | 'UNSPECIFIED'
--   include_archived     boolean (default false)
--   needs_review         boolean
-- =====================================================================

-- Grouping label: trims, collapses whitespace and title-cases so that
-- "RETEVMO  80 MG" and "Retevmo 80 mg" fall in one group. Stored values
-- are left untouched.
create or replace function public.npp_label(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(initcap(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

create or replace function public.npp_fy(p date)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p is null then null
    when extract(month from p) >= 4
      then 'FY ' || extract(year from p)::int || '-' || lpad(((extract(year from p)::int + 1) % 100)::text, 2, '0')
    else 'FY ' || (extract(year from p)::int - 1) || '-' || lpad((extract(year from p)::int % 100)::text, 2, '0')
  end;
$$;

create or replace function public.npp_fy_quarter(p date)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p is null then null
    else public.npp_fy(p) || ' Q' || (((extract(month from p)::int + 8) % 12) / 3 + 1)
  end;
$$;

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
    and (p ->> 'date_from' is null or s.sale_date >= (p ->> 'date_from')::date)
    and (p ->> 'date_to'   is null or s.sale_date <= (p ->> 'date_to')::date)
    and (p ->> 'product'   is null or public.npp_label(s.product_name)  = p ->> 'product')
    and (p ->> 'manager'   is null or public.npp_label(s.manager)       = p ->> 'manager')
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
      or s.voucher_no ilike '%' || (p ->> 'search') || '%'));
$$;

-- ---------------------------------------------------------------------
-- Dashboard payload: KPIs + every chart series in one round trip.
-- Monetary sums are always split by currency; INR Value is the
-- source-reported INR figure and is summed on its own.
-- ---------------------------------------------------------------------
create or replace function public.npp_dashboard(p jsonb default '{}'::jsonb, p_top int default 10)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (select * from public.npp_filtered(p)),
  base as (
    select f.*, coalesce(f.currency, 'UNSPECIFIED') as cur,
           to_char(f.sale_date, 'YYYY-MM') as month
    from f
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'records', count(*),
        'inr_value', coalesce(sum(inr_value), 0),
        'records_with_inr', count(inr_value),
        'hospitals', count(distinct lower(public.npp_label(hospital_name))),
        'doctors', count(distinct lower(regexp_replace(public.npp_label(doctor_name), '^Dr\.?\s*', '', 'i'))),
        'products', count(distinct lower(public.npp_label(product_name))),
        'undated', count(*) filter (where sale_date is null),
        'needs_review', count(*) filter (where needs_review),
        'conflicts', count(*) filter (where pending_source is not null),
        'missing_from_source', count(*) filter (where missing_from_source_at is not null),
        'first_date', min(sale_date),
        'last_date', max(sale_date))
      from base),
    'by_currency', coalesce((
      select jsonb_agg(x order by x ->> 'currency') from (
        select jsonb_build_object(
          'currency', cur,
          'records', count(*),
          'value', coalesce(sum(value), 0),
          'records_with_value', count(value),
          'avg_value', round(avg(value), 2),
          'shipping', coalesce(sum(shipping_charges), 0),
          'inr_value', coalesce(sum(inr_value), 0)) as x
        from base group by cur) t), '[]'::jsonb),
    'quantity_by_unit', coalesce((
      select jsonb_agg(jsonb_build_object('unit', unit, 'quantity', qty, 'records', n) order by qty desc)
      from (select coalesce(quantity_unit, 'UNSPECIFIED') as unit, sum(quantity) as qty, count(*) as n
              from base where quantity is not null group by 1) q), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object(
          'month', month, 'currency', cur, 'records', n, 'value', v, 'inr_value', inr, 'shipping', sh)
        order by month, cur)
      from (select month, cur, count(*) n, coalesce(sum(value),0) v, coalesce(sum(inr_value),0) inr,
                   coalesce(sum(shipping_charges),0) sh
              from base where month is not null group by month, cur) m), '[]'::jsonb),
    'by_product', coalesce((
      select jsonb_agg(row_to_json(g)::jsonb order by g.inr_value desc nulls last)
      from (select public.npp_label(product_name) as key, count(*) as records,
                   coalesce(sum(inr_value),0) as inr_value,
                   coalesce(sum(value) filter (where currency = 'USD'),0) as value_usd,
                   coalesce(sum(value) filter (where currency = 'EUR'),0) as value_eur,
                   coalesce(sum(value) filter (where currency is null),0) as value_unspecified
              from base group by 1 order by 3 desc limit p_top) g), '[]'::jsonb),
    'by_manager', coalesce((
      select jsonb_agg(row_to_json(g)::jsonb order by g.inr_value desc nulls last)
      from (select coalesce(public.npp_label(manager), 'Not stated') as key, count(*) as records,
                   coalesce(sum(inr_value),0) as inr_value,
                   coalesce(sum(value) filter (where currency = 'USD'),0) as value_usd,
                   coalesce(sum(value) filter (where currency = 'EUR'),0) as value_eur,
                   coalesce(sum(value) filter (where currency is null),0) as value_unspecified
              from base group by 1 order by 3 desc limit p_top) g), '[]'::jsonb),
    'by_hospital', coalesce((
      select jsonb_agg(row_to_json(g)::jsonb order by g.inr_value desc nulls last)
      from (select coalesce(public.npp_label(hospital_name), 'Not stated') as key, count(*) as records,
                   coalesce(sum(inr_value),0) as inr_value,
                   coalesce(sum(value) filter (where currency = 'USD'),0) as value_usd,
                   coalesce(sum(value) filter (where currency = 'EUR'),0) as value_eur,
                   coalesce(sum(value) filter (where currency is null),0) as value_unspecified
              from base group by 1 order by 3 desc limit p_top) g), '[]'::jsonb),
    'by_doctor', coalesce((
      select jsonb_agg(row_to_json(g)::jsonb order by g.inr_value desc nulls last)
      from (select coalesce(public.npp_label(doctor_name), 'Not stated') as key, count(*) as records,
                   coalesce(sum(inr_value),0) as inr_value,
                   coalesce(sum(value) filter (where currency = 'USD'),0) as value_usd,
                   coalesce(sum(value) filter (where currency = 'EUR'),0) as value_eur,
                   coalesce(sum(value) filter (where currency is null),0) as value_unspecified
              from base group by 1 order by 3 desc limit p_top) g), '[]'::jsonb),
    'by_place', coalesce((
      select jsonb_agg(row_to_json(g)::jsonb order by g.inr_value desc nulls last)
      from (select coalesce(public.npp_label(place_of_sale), 'Not stated') as key, count(*) as records,
                   coalesce(sum(inr_value),0) as inr_value,
                   coalesce(sum(value) filter (where currency = 'USD'),0) as value_usd,
                   coalesce(sum(value) filter (where currency = 'EUR'),0) as value_eur,
                   coalesce(sum(value) filter (where currency is null),0) as value_unspecified
              from base group by 1 order by 3 desc limit p_top) g), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Generic grouped report.
-- ---------------------------------------------------------------------
create or replace function public.npp_report(p_group text, p jsonb default '{}'::jsonb)
returns table (
  group_key   text,
  sort_key    text,
  currency    text,
  records     bigint,
  quantity    numeric,
  value       numeric,
  shipping    numeric,
  inr_value   numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_group not in ('day', 'month', 'quarter', 'financial_year', 'product', 'manager',
                     'hospital', 'doctor', 'place') then
    raise exception 'Unsupported grouping %', p_group using errcode = '22023';
  end if;

  return query
  with f as (select * from public.npp_filtered(p)),
  g as (
    select
      case p_group
        when 'day'            then coalesce(to_char(sale_date, 'DD Mon YYYY'), 'Undated')
        when 'month'          then coalesce(to_char(sale_date, 'Mon YYYY'), 'Undated')
        when 'quarter'        then coalesce(public.npp_fy_quarter(sale_date), 'Undated')
        when 'financial_year' then coalesce(public.npp_fy(sale_date), 'Undated')
        when 'product'        then coalesce(public.npp_label(product_name), 'Not stated')
        when 'manager'        then coalesce(public.npp_label(manager), 'Not stated')
        when 'hospital'       then coalesce(public.npp_label(hospital_name), 'Not stated')
        when 'doctor'         then coalesce(public.npp_label(doctor_name), 'Not stated')
        when 'place'          then coalesce(public.npp_label(place_of_sale), 'Not stated')
      end as k,
      case p_group
        when 'day'            then coalesce(to_char(sale_date, 'YYYY-MM-DD'), '9999')
        when 'month'          then coalesce(to_char(sale_date, 'YYYY-MM'), '9999')
        when 'quarter'        then coalesce(public.npp_fy_quarter(sale_date), '9999')
        when 'financial_year' then coalesce(public.npp_fy(sale_date), '9999')
        else null
      end as sk,
      coalesce(f.currency, 'UNSPECIFIED') as cur,
      f.quantity, f.value, f.shipping_charges, f.inr_value
    from f
  )
  select g.k, coalesce(g.sk, g.k), g.cur, count(*), sum(g.quantity), coalesce(sum(g.value), 0),
         coalesce(sum(g.shipping_charges), 0), coalesce(sum(g.inr_value), 0)
  from g
  group by g.k, g.sk, g.cur
  order by case when g.sk is null then null else g.sk end nulls last,
           sum(g.inr_value) desc nulls last, g.k, g.cur;
end;
$$;

-- Distinct filter values (labels)
create or replace function public.npp_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'products',  coalesce((select jsonb_agg(distinct public.npp_label(product_name))  from public.npp_sales where status = 'active' and product_name is not null), '[]'),
    'managers',  coalesce((select jsonb_agg(distinct public.npp_label(manager))       from public.npp_sales where status = 'active' and nullif(trim(manager), '') is not null), '[]'),
    'hospitals', coalesce((select jsonb_agg(distinct public.npp_label(hospital_name)) from public.npp_sales where status = 'active' and nullif(trim(hospital_name), '') is not null), '[]'),
    'doctors',   coalesce((select jsonb_agg(distinct public.npp_label(doctor_name))   from public.npp_sales where status = 'active' and nullif(trim(doctor_name), '') is not null), '[]'),
    'places',    coalesce((select jsonb_agg(distinct public.npp_label(place_of_sale)) from public.npp_sales where status = 'active' and nullif(trim(place_of_sale), '') is not null), '[]'),
    'financial_years', coalesce((select jsonb_agg(distinct public.npp_fy(sale_date)) from public.npp_sales where sale_date is not null), '[]'),
    'currencies', coalesce((select jsonb_agg(distinct coalesce(currency, 'UNSPECIFIED')) from public.npp_sales), '[]')
  );
$$;

revoke all on function public.npp_filtered(jsonb) from public, anon;
revoke all on function public.npp_dashboard(jsonb, int) from public, anon;
revoke all on function public.npp_report(text, jsonb) from public, anon;
revoke all on function public.npp_filter_options() from public, anon;
grant execute on function public.npp_filtered(jsonb) to authenticated;
grant execute on function public.npp_dashboard(jsonb, int) to authenticated;
grant execute on function public.npp_report(text, jsonb) to authenticated;
grant execute on function public.npp_filter_options() to authenticated;
