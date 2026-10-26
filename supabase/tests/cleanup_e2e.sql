-- Removes the throw-away E2E test accounts and the test sales records they created.
-- Run once in the Supabase SQL editor after creating your real administrator.
-- (Sales deletion and audit-log edits are normally blocked by triggers; this
--  maintenance script bypasses them for test data only.)
begin;
set local session_replication_role = replica;
create temp table t_users on commit drop as
  select id from auth.users where email like 'e2e-%@ikris-test.example';
create temp table t_sales on commit drop as
  select id from public.npp_sales where particulars = 'E2E Test Customer' and source = 'manual';
delete from public.audit_logs
 where actor_id in (select id from t_users)
    or entity_id in (select id::text from t_sales)
    or entity_id in (select id::text from t_users);
delete from public.npp_sales where id in (select id from t_sales);
set local session_replication_role = origin;
delete from auth.users where id in (select id from t_users);
commit;
