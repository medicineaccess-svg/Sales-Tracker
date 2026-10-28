-- Manager labels in npp_performance come from master data ("HO", not "Ho").
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

