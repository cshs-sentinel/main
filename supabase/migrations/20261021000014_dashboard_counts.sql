-- Migration: 20261021000014_dashboard_counts.sql
-- Role-filtered dashboard aggregates (Phase 5, Task 5.1).
-- The dashboard must show each role only what it is allowed to know:
--   * students  -> their own records only (no school-wide numbers at all)
--   * teachers  -> own records + school counts (counts only, never names)
--   * responders-> own records + school counts + open-case queue summary
--   * admins    -> all of the above + user counts and an audit summary
-- This function returns NUMBERS ONLY: no names, no locations, no free text.

create or replace function public.dashboard_counts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := public.my_school_id();
  v_role public.app_role;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_school is null then
    raise exception 'no school is assigned to this account';
  end if;

  select p.role into v_role from public.profiles p where p.id = auth.uid();

  -- Own records (every role)
  v_out := v_out || jsonb_build_object(
    'role', coalesce(v_role::text, 'unknown'),
    'my_open_incidents', (
      select count(*) from public.incidents i
      where i.school_id = v_school and i.created_by = auth.uid()
        and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')
    ),
    'my_open_reports', (
      select count(*) from public.hazard_reports h
      where h.school_id = v_school and h.reporter_id = auth.uid()
        and h.status <> 'resolved'
    ),
    'my_check_ins_today', (
      select count(*) from public.check_ins c
      where c.school_id = v_school and c.profile_id = auth.uid()
        and c.checked_in_at >= current_date
    ),
    'my_need_help', (
      select count(*) from public.check_ins c
      where c.school_id = v_school and c.profile_id = auth.uid()
        and c.status = 'need_help'
    )
  );

  -- School-wide counts: staff roles only (counts, never identities)
  if v_role in ('teacher_staff', 'responder', 'administrator') then
    v_out := v_out || jsonb_build_object(
      'school_open_incidents', (
        select count(*) from public.incidents i
        where i.school_id = v_school
          and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')
      ),
      'school_unacknowledged_incidents', (
        select count(*) from public.incidents i
        where i.school_id = v_school and i.status = 'new'
      ),
      'school_oldest_unacknowledged_minutes', (
        select coalesce(floor(extract(epoch from (now() - min(i.created_at))) / 60)::bigint, 0)
        from public.incidents i
        where i.school_id = v_school and i.status = 'new'
      ),
      'school_open_reports', (
        select count(*) from public.hazard_reports h
        where h.school_id = v_school and h.status <> 'resolved'
      ),
      'school_check_ins_today', (
        select count(*) from public.check_ins c
        where c.school_id = v_school and c.checked_in_at >= current_date
      ),
      'school_need_help', (
        select count(*) from public.check_ins c
        where c.school_id = v_school and c.status = 'need_help'
      )
    );
  end if;

  -- Administrator extras
  if v_role = 'administrator' then
    v_out := v_out || jsonb_build_object(
      'users_total', (
        select count(*) from public.profiles p where p.school_id = v_school
      ),
      'users_by_role', (
        select coalesce(jsonb_object_agg(r.role::text, r.n), '{}'::jsonb)
        from (
          select p.role, count(*) as n
          from public.profiles p
          where p.school_id = v_school
          group by p.role
        ) r
      ),
      'audit_rows_30d', (
        select count(*) from public.audit_logs a
        where a.created_at > now() - interval '30 days'
      )
    );
  end if;

  return v_out;
end;
$$;

comment on function public.dashboard_counts() is 'Role-filtered dashboard aggregates. Numbers only — no names, locations or free text. Students receive own-record counts only.';

revoke execute on function public.dashboard_counts() from public;
grant execute on function public.dashboard_counts() to authenticated;
