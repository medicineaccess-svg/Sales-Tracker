-- =====================================================================
-- Migration 5: trigger functions must not be callable through the API.
-- (Flagged by the Supabase security advisor.) The remaining
-- SECURITY DEFINER RPCs callable by `authenticated` are intentional:
-- each one checks is_admin() / auth.uid() internally.
-- =====================================================================
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.npp_sales_guard()      from public, anon, authenticated;
revoke all on function public.npp_sales_audit()      from public, anon, authenticated;
revoke all on function public.npp_sales_no_delete()  from public, anon, authenticated;
revoke all on function public.audit_logs_immutable() from public, anon, authenticated;
revoke all on function public.touch_updated_at()     from public, anon, authenticated;
