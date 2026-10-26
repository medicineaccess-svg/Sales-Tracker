-- =====================================================================
-- Migration 4: attributed audit writer for Edge Functions, and report
-- ordering fix (undated groups sort last).
-- =====================================================================

-- Service-role-only audit writer that records the acting admin explicitly
-- (Edge Functions run with the service role, where auth.uid() is null).
create or replace function public.write_audit_for(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_department_code text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, actor_email, actor_type, action, entity_type, entity_id,
                                 department_code, summary, metadata)
  values (p_actor, (select email from public.profiles where id = p_actor),
          case when p_actor is null then 'system' else 'user' end,
          p_action, p_entity_type, p_entity_id, p_department_code, p_summary,
          coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.write_audit_for(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit_for(uuid, text, text, text, text, text, jsonb) to service_role;

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
        when 'day'            then coalesce(to_char(f.sale_date, 'DD Mon YYYY'), 'Undated')
        when 'month'          then coalesce(to_char(f.sale_date, 'Mon YYYY'), 'Undated')
        when 'quarter'        then coalesce(public.npp_fy_quarter(f.sale_date), 'Undated')
        when 'financial_year' then coalesce(public.npp_fy(f.sale_date), 'Undated')
        when 'product'        then coalesce(public.npp_label(f.product_name), 'Not stated')
        when 'manager'        then coalesce(public.npp_label(f.manager), 'Not stated')
        when 'hospital'       then coalesce(public.npp_label(f.hospital_name), 'Not stated')
        when 'doctor'         then coalesce(public.npp_label(f.doctor_name), 'Not stated')
        when 'place'          then coalesce(public.npp_label(f.place_of_sale), 'Not stated')
      end as k,
      case p_group
        when 'day'            then to_char(f.sale_date, 'YYYY-MM-DD')
        when 'month'          then to_char(f.sale_date, 'YYYY-MM')
        when 'quarter'        then public.npp_fy_quarter(f.sale_date)
        when 'financial_year' then public.npp_fy(f.sale_date)
        else null
      end as sk,
      p_group in ('day', 'month', 'quarter', 'financial_year') as is_time,
      coalesce(f.currency, 'UNSPECIFIED') as cur,
      f.quantity, f.value, f.shipping_charges, f.inr_value
    from f
  ),
  agg as (
    select g.k, g.sk, g.is_time, g.cur,
           count(*) as n, sum(g.quantity) as q, coalesce(sum(g.value), 0) as v,
           coalesce(sum(g.shipping_charges), 0) as s, coalesce(sum(g.inr_value), 0) as i
    from g
    group by g.k, g.sk, g.is_time, g.cur
  ),
  grp as (
    select agg.k, sum(agg.i) as group_inr from agg group by agg.k
  )
  select agg.k, coalesce(agg.sk, agg.k), agg.cur, agg.n, agg.q, agg.v, agg.s, agg.i
  from agg join grp on grp.k = agg.k
  order by
    case when agg.is_time then agg.sk end asc nulls last,       -- chronological, undated last
    case when not agg.is_time then grp.group_inr end desc nulls last, -- categories by INR
    agg.k, agg.cur;
end;
$$;

revoke all on function public.npp_report(text, jsonb) from public, anon;
grant execute on function public.npp_report(text, jsonb) to authenticated;
