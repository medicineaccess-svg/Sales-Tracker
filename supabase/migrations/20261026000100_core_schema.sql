-- =====================================================================
-- Ikris Pharma Network — Sales Tracker
-- Migration 1: core schema (departments, profiles, settings, audit, sync)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name        text not null check (length(trim(name)) between 2 and 80),
  status      text not null default 'inactive' check (status in ('active', 'inactive')),
  description text,
  -- Source/data configuration for this department (sheet id, worksheet, mapping version…)
  config      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();

insert into public.departments (code, name, status, description, sort_order, config) values
  ('npp', 'NPP', 'active', 'Named Patient Program', 10,
     jsonb_build_object(
       'source', 'google_sheets',
       'spreadsheet_id', '1yEn6NflVFtU9Bjv4vcRZsqoKTpEeeviGczBUPcLe0Us',
       'sheet_gid', 631975196,
       'sheet_title', 'Sheet1',
       'header_row', 1,
       'mapping_version', 1,
       'sync_policy', 'sheet_authoritative_unless_locally_modified'
     )),
  ('export', 'Export', 'inactive', 'Export sales — module reserved for future activation', 20, '{}'::jsonb),
  ('rare_disease', 'Rare Disease', 'inactive', 'Rare Disease sales — module reserved for future activation', 30, '{}'::jsonb);

-- ---------------------------------------------------------------------
-- Profiles (one per auth user). Role/department are protected: no
-- client-side INSERT/UPDATE policies exist; changes go through
-- SECURITY DEFINER functions that check the caller is an active admin.
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text check (full_name is null or length(full_name) <= 120),
  role          text not null default 'department_user' check (role in ('admin', 'department_user')),
  department_id uuid references public.departments (id) on delete restrict,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint department_user_needs_department
    check (role = 'admin' or department_id is not null or is_active = false)
);

create index profiles_department_idx on public.profiles (department_id);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Application settings
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value       jsonb not null,
  is_public   boolean not null default false,   -- readable by every signed-in user
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

insert into public.app_settings (key, value, is_public, description) values
  ('bootstrap_admin_emails', '["medicine.access@ikrispharmanetwork.com"]'::jsonb, false,
     'Emails that are given the admin role automatically when their auth account is created.'),
  ('reporting.financial_year_start_month', '4'::jsonb, true,
     'Indian financial year starts in April (1 Apr – 31 Mar).'),
  ('reporting.inr_value_definition', '"Source-reported INR value from the NPP sheet column ''INR Value''. Not recalculated by the CRM."'::jsonb, true,
     'How INR Value is interpreted in dashboards and reports.'),
  ('sync.schedule', '{"enabled": false, "cron": "30 1 * * *"}'::jsonb, false,
     'Scheduled Google Sheets synchronisation (UTC cron). Activated via pg_cron — see docs/GOOGLE_SHEETS_SYNC.md.');

create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER, read-only, fixed search_path)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active
  );
$$;

create or replace function public.has_department_access(p_department_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    where p.id = auth.uid()
      and p.is_active
      and (p.role = 'admin' or d.code = p_department_code)
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.has_department_access(text) from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_department_access(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_id        uuid references auth.users (id) on delete set null,
  actor_email     text,
  actor_type      text not null default 'user' check (actor_type in ('user', 'system')),
  action          text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type     text,
  entity_id       text,
  department_code text,
  summary         text,
  changes         jsonb,   -- {"field": {"old": …, "new": …}} — patient names are never stored here
  metadata        jsonb not null default '{}'::jsonb
);

create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_dept_idx on public.audit_logs (department_code, occurred_at desc);

create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Internal writer used by triggers and server-side functions.
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_department_code text,
  p_summary text,
  p_changes jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is not null then
    select email into v_email from public.profiles where id = v_uid;
  end if;
  insert into public.audit_logs (actor_id, actor_email, actor_type, action, entity_type, entity_id,
                                 department_code, summary, changes, metadata)
  values (v_uid, v_email, case when v_uid is null then 'system' else 'user' end,
          p_action, p_entity_type, p_entity_id, p_department_code, p_summary, p_changes,
          coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.write_audit(text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit(text, text, text, text, text, jsonb, jsonb) to service_role;

-- Client-callable event logger, restricted to a fixed set of non-privileged events.
create or replace function public.log_client_event(
  p_action text,
  p_department_code text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_action not in ('auth.login', 'auth.logout', 'report.export', 'sales.export', 'auth.password_changed') then
    raise exception 'Event % is not allowed', p_action using errcode = '22023';
  end if;
  if p_department_code is not null and not public.has_department_access(p_department_code) then
    raise exception 'No access to department' using errcode = '42501';
  end if;
  -- Keep metadata small and free of free-text patient data
  if pg_column_size(p_metadata) > 4000 then
    raise exception 'Metadata too large' using errcode = '22023';
  end if;
  perform public.write_audit(p_action, null, null, p_department_code,
                             replace(p_action, '.', ' '), null, p_metadata);
end;
$$;

revoke all on function public.log_client_event(text, text, jsonb) from public, anon;
grant execute on function public.log_client_event(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Sync runs
-- ---------------------------------------------------------------------
create table public.sync_runs (
  id               uuid primary key default gen_random_uuid(),
  department_code  text not null references public.departments (code),
  source_sheet_id  text,
  source_range     text,
  trigger          text not null check (trigger in ('initial', 'manual', 'scheduled')),
  status           text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  rows_read        int not null default 0,
  rows_skipped     int not null default 0,   -- total/blank rows
  inserted         int not null default 0,
  updated          int not null default 0,
  unchanged        int not null default 0,
  conflicts        int not null default 0,   -- sheet changed but CRM copy was edited locally
  invalid          int not null default 0,
  flagged          int not null default 0,   -- imported with data-quality issues
  missing_from_source int not null default 0,
  errors           jsonb not null default '[]'::jsonb,
  notes            text,
  initiated_by     uuid references auth.users (id) on delete set null
);

create index sync_runs_dept_idx on public.sync_runs (department_code, started_at desc);

-- ---------------------------------------------------------------------
-- New auth user → profile. Role/department come ONLY from app_metadata
-- (writable only with the service role) or the bootstrap admin list.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bootstrap jsonb;
  v_role text := 'department_user';
  v_dept_id uuid;
  v_active boolean := true;
begin
  select value into v_bootstrap from public.app_settings where key = 'bootstrap_admin_emails';

  if v_bootstrap is not null and v_bootstrap ? lower(new.email) then
    v_role := 'admin';
  elsif coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin' then
    v_role := 'admin';
  end if;

  select id into v_dept_id from public.departments
   where code = new.raw_app_meta_data ->> 'department';

  if v_role <> 'admin' and v_dept_id is null then
    v_active := false;   -- no department assigned → no access until an admin assigns one
  end if;

  insert into public.profiles (id, email, full_name, role, department_id, is_active)
  values (new.id, lower(new.email),
          nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
          v_role, v_dept_id, v_active)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Profile management RPCs
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.profiles
     set full_name = nullif(trim(p_full_name), '')
   where id = auth.uid();
end;
$$;

revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated;

create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_role text,
  p_department_code text,
  p_is_active boolean,
  p_full_name text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.profiles;
  v_after public.profiles;
  v_dept_id uuid;
  v_admins int;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change user access' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'department_user') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if p_department_code is not null then
    select id into v_dept_id from public.departments where code = p_department_code;
    if v_dept_id is null then
      raise exception 'Unknown department' using errcode = '22023';
    end if;
  end if;

  if p_role = 'department_user' and v_dept_id is null and p_is_active then
    raise exception 'Department users must be assigned to a department' using errcode = '22023';
  end if;

  -- Never allow removing the last active admin (prevents lock-out)
  if v_before.role = 'admin' and v_before.is_active and (p_role <> 'admin' or not p_is_active) then
    select count(*) into v_admins from public.profiles where role = 'admin' and is_active and id <> p_user_id;
    if v_admins = 0 then
      raise exception 'At least one active administrator is required' using errcode = '22023';
    end if;
  end if;

  update public.profiles
     set role = p_role,
         department_id = v_dept_id,
         is_active = p_is_active,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
   where id = p_user_id
  returning * into v_after;

  perform public.write_audit(
    'user.access_changed', 'profile', p_user_id::text, p_department_code,
    'User access updated for ' || v_after.email,
    jsonb_strip_nulls(jsonb_build_object(
      'role', case when v_before.role is distinct from v_after.role
                   then jsonb_build_object('old', v_before.role, 'new', v_after.role) end,
      'department_id', case when v_before.department_id is distinct from v_after.department_id
                   then jsonb_build_object('old', v_before.department_id, 'new', v_after.department_id) end,
      'is_active', case when v_before.is_active is distinct from v_after.is_active
                   then jsonb_build_object('old', v_before.is_active, 'new', v_after.is_active) end
    )));

  return v_after;
end;
$$;

revoke all on function public.admin_set_user_access(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_set_user_access(uuid, text, text, boolean, text) to authenticated;

-- Department configuration changes (admin only)
create or replace function public.admin_update_department(
  p_code text,
  p_status text,
  p_description text,
  p_config jsonb
)
returns public.departments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.departments;
  v_after public.departments;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can configure departments' using errcode = '42501';
  end if;
  select * into v_before from public.departments where code = p_code for update;
  if not found then
    raise exception 'Unknown department' using errcode = 'P0002';
  end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if p_code <> 'npp' and p_status = 'active' then
    raise exception 'This department has no data module yet. Configure its schema before activating it.'
      using errcode = '22023';
  end if;

  update public.departments
     set status = p_status,
         description = coalesce(p_description, description),
         config = coalesce(p_config, config)
   where code = p_code
  returning * into v_after;

  perform public.write_audit('department.config_changed', 'department', p_code, p_code,
    'Department ' || v_after.name || ' configuration updated',
    jsonb_build_object('status', jsonb_build_object('old', v_before.status, 'new', v_after.status),
                       'config', jsonb_build_object('old', v_before.config, 'new', v_after.config)));
  return v_after;
end;
$$;

revoke all on function public.admin_update_department(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_update_department(text, text, text, jsonb) to authenticated;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change settings' using errcode = '42501';
  end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then
    raise exception 'Unknown setting' using errcode = 'P0002';
  end if;
  update public.app_settings set value = p_value, updated_by = auth.uid() where key = p_key;
  perform public.write_audit('settings.changed', 'app_setting', p_key, null,
    'Setting ' || p_key || ' changed',
    case when p_key = 'bootstrap_admin_emails' then null
         else jsonb_build_object(p_key, jsonb_build_object('old', v_old, 'new', p_value)) end);
end;
$$;

revoke all on function public.admin_update_setting(text, jsonb) from public, anon;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.departments  enable row level security;
alter table public.profiles     enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs   enable row level security;
alter table public.sync_runs    enable row level security;

-- departments: every signed-in user sees the list (to render "Coming soon");
-- changes only through admin_update_department().
create policy departments_read on public.departments
  for select to authenticated using (true);

-- profiles: own row, or everything for admins. No write policies.
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

-- app_settings: public keys for everyone signed in; all keys for admins.
create policy app_settings_read on public.app_settings
  for select to authenticated using (is_public or (select public.is_admin()));

-- audit_logs: admins see all; department users see their department's entries.
create policy audit_logs_read on public.audit_logs
  for select to authenticated using (
    (select public.is_admin())
    or (department_code is not null and public.has_department_access(department_code))
  );

-- sync_runs: admins all; department users their department.
create policy sync_runs_read on public.sync_runs
  for select to authenticated using (public.has_department_access(department_code));

-- Lock down table privileges for anon entirely.
revoke all on public.departments, public.profiles, public.app_settings, public.audit_logs, public.sync_runs from anon;
revoke insert, update, delete on public.departments, public.profiles, public.app_settings, public.audit_logs, public.sync_runs from authenticated;
