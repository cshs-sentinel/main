-- Migration 0001: Identity, roles, and baseline RLS
-- Phase 1 foundation for MCSI-08 SENTINEL
-- Scope: app_role enum, profiles table, signup trigger, audit_logs, RLS policies
-- This migration does NOT include school structure, reports, incidents, or alerts.

-- 1. Enum: application roles
create type public.app_role as enum (
  'student',
  'teacher_staff',
  'responder',
  'administrator'
);

-- 2. Table: profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'student',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Application profile linked to Supabase auth user. Role drives RLS.';
comment on column public.profiles.role is 'Default student. Elevated only via admin RPC.';

-- 3. Table: audit_logs (append-only)
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Append-only audit trail for privileged actions.';

-- 4. Helper: is_admin()
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrator'
  );
$$;

comment on function public.is_admin() is 'Returns true if the current user has administrator role.';

-- 5. Trigger: auto-create profile on new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'student');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 6. RPC: admin-only role change
create or replace function public.admin_set_user_role(
  target_user_id uuid,
  new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied: admin required';
  end if;

  update public.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'role_changed',
    'profiles',
    target_user_id::text,
    jsonb_build_object('new_role', new_role)
  );
end;
$$;

comment on function public.admin_set_user_role(uuid, public.app_role) is 'Admin-only role change with audit log.';

-- 7. RLS: profiles
alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- Admins can read all profiles
create policy "profiles_select_admin"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- No client insert policy: profile created only by trigger (security definer)
-- No client update policy: role changes only via admin_set_user_role RPC
-- No client delete policy: cascade from auth.users only

-- 8. RLS: audit_logs (admin read only; insert only via security definer functions)
alter table public.audit_logs enable row level security;

create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

-- No insert/update/delete policies for clients

-- 9. Grants for API exposure
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles to authenticated;
grant select on public.audit_logs to authenticated;
-- Note: PostgREST will not allow inserts/updates without table-level grants + policies.
-- RPC functions run with security definer and their own privilege checks.
