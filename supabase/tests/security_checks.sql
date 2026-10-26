-- =====================================================================
-- Security regression checks (RLS, privilege escalation, provenance).
--
-- Run in the Supabase SQL editor or with:
--   psql "$DATABASE_URL" -f supabase/tests/security_checks.sql
--
-- Creates throw-away users inside a transaction, asserts behaviour, and
-- always ends with ROLLBACK via an exception — nothing is persisted.
-- Output: "ALL SECURITY CHECKS PASSED" (as the final error message) or the
-- first failing assertion.
-- =====================================================================
do $$
declare
  npp_id uuid := gen_random_uuid();
  exp_id uuid := gen_random_uuid();
  adm_id uuid := gen_random_uuid();
  n int;
  ok boolean;
  new_id uuid;
  v text;
  total int;
begin
  select count(*) into total from public.npp_sales;

  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
    (npp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'npp.check@example.invalid', '{"department":"npp"}', '{}', now(), now()),
    (exp_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export.check@example.invalid', '{"department":"export"}', '{}', now(), now()),
    (adm_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.check@example.invalid', '{"role":"admin"}', '{}', now(), now());

  -- user_metadata must never grant a role
  select role into v from public.profiles where id = npp_id;
  assert v = 'department_user', 'new NPP user should be department_user';

  -- ---------------- NPP department user ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', npp_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.npp_sales;
  assert n = total, 'NPP user should read every NPP sale';

  ok := false;
  begin update public.profiles set role = 'admin' where id = npp_id;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'NPP user must not be able to update profiles directly';

  ok := false;
  begin perform public.admin_set_user_access(npp_id, 'admin', null, true);
  exception when others then ok := true; end;
  assert ok, 'NPP user must not be able to call admin_set_user_access';

  ok := false;
  begin delete from public.npp_sales where true;
  exception when others then ok := true; end;
  assert ok, 'Sales records must not be deletable';

  insert into public.npp_sales (sale_date, particulars, product_name, voucher_no, quantity, quantity_unit, currency, rate, value, source, source_key)
  values ('2026-10-01', 'Check Patient', 'Check Product', 'CHECK/001', 1, 'PACK', 'USD', 10, 10, 'google_sheets', 'HIJACK')
  returning id into new_id;
  select source || '/' || coalesce(source_key, 'null') into v from public.npp_sales where id = new_id;
  assert v = 'manual/null', 'Client cannot spoof provenance on insert';

  ok := false;
  begin update public.npp_sales set status = 'archived' where id = new_id;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'Only admins may archive';

  ok := false;
  begin perform public.write_audit('x.y', null, null, null, 'x');
  exception when others then ok := true; end;
  assert ok, 'write_audit must not be callable by users';

  ok := false;
  begin perform public.npp_sync_apply(gen_random_uuid(), '[]');
  exception when others then ok := true; end;
  assert ok, 'Sync functions must be service-role only';

  ok := false;
  begin update public.audit_logs set summary = 'tampered' where true;
  exception when others then ok := true; end;
  assert ok, 'Audit log must be immutable';
  reset role;

  -- ---------------- Export department user ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', exp_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.npp_sales;
  assert n = 0, 'Export user must not read NPP sales';
  select (public.npp_dashboard('{}'::jsonb) -> 'totals' ->> 'records')::int into n;
  assert n = 0, 'Export user must not aggregate NPP sales';
  ok := false;
  begin insert into public.npp_sales (sale_date, particulars, product_name) values ('2026-10-01', 'x', 'y');
  exception when others then ok := true; end;
  assert ok, 'Export user must not insert NPP sales';
  reset role;

  -- ---------------- Admin ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', adm_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.npp_sales set status = 'archived' where id = new_id;
  get diagnostics n = row_count;
  assert n = 1, 'Admin can archive';
  reset role;

  -- ---------------- Anonymous ----------------
  set local role anon;
  ok := false;
  begin select count(*) into n from public.npp_sales;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'Anonymous access must be denied';
  reset role;

  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end $$;
