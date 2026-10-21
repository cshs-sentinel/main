-- Migration: 20261021000012_check_ins.sql
-- Safety check-ins (Phase 3, Task 3.6).
-- A check-in records what a person TOLD the system. It is never presented as a
-- verified location: the row carries an explicit location_source
-- (self_selected | schedule_derived | staff_verified).
-- Check-ins are an immutable log (no client update/delete); retention is 90 days
-- per docs/ARCHITECTURE.md section 8.2 (retention job is a later phase).

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  profile_id uuid not null default auth.uid() references public.profiles (id),
  location_id uuid references public.locations (id), -- optional context
  location_source text not null,
  period text,
  status text not null default 'safe',
  checked_in_at timestamptz not null default now(),
  constraint check_ins_location_source check (location_source in ('self_selected', 'schedule_derived', 'staff_verified')),
  constraint check_ins_status check (status in ('safe', 'need_help'))
);

comment on table public.check_ins is 'Safety check-ins. A check-in is a self-report, not a verified location. Immutable log; no client delete.';
comment on column public.check_ins.location_source is 'How the location was chosen: self_selected (user picked), schedule_derived (from the timetable, still unverified), staff_verified (confirmed by staff).';
comment on column public.check_ins.status is 'safe | need_help. need_help is a flag for responders; it does not raise an incident (see Phase 4 SOS flow).';

create index idx_check_ins_school on public.check_ins (school_id);
create index idx_check_ins_profile on public.check_ins (profile_id);
create index idx_check_ins_time on public.check_ins (checked_in_at desc);

-- ============================================================
-- 1. Validation trigger
-- ============================================================
create or replace function public.validate_check_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
begin
  if auth.uid() is not null then
    new.profile_id := coalesce(new.profile_id, auth.uid());
    if new.profile_id is distinct from auth.uid() then
      raise exception 'check-in must be recorded for yourself';
    end if;
  end if;

  if new.period is not null and char_length(new.period) > 60 then
    raise exception 'period label is too long';
  end if;

  -- staff_verified may only be set by reviewers
  if new.location_source = 'staff_verified' and not public.is_reviewer() then
    raise exception 'only responders or administrators can record a staff-verified location';
  end if;

  -- Optional location: must exist, be in the same school, and not be archived
  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status = 'archived' then
      raise exception 'cannot check in at an archived location';
    end if;
  end if;

  -- A schedule-derived check-in must match an active schedule for today
  if new.location_source = 'schedule_derived' then
    if new.location_id is null then
      raise exception 'a schedule-derived check-in needs a location';
    end if;
    if not exists (
      select 1 from public.schedules s
      where s.location_id = new.location_id
        and s.status = 'active'
        and s.day_of_week = extract(dow from current_date)::int
        and s.effective_from <= current_date
        and (s.effective_until is null or s.effective_until >= current_date)
    ) then
      raise exception 'no active schedule for that location today';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_check_in() is 'Server-side check-in validation: identity, location scope, source honesty (schedule_derived needs a live schedule), staff-only staff_verified.';

create trigger check_ins_validate
  before insert on public.check_ins
  for each row execute function public.validate_check_in();

-- ============================================================
-- 2. RLS: own write, own + reviewer read, no update/delete
-- ============================================================
alter table public.check_ins enable row level security;

create policy "check_ins_select_own_or_reviewer"
  on public.check_ins for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and (profile_id = auth.uid() or public.is_reviewer())
  );

create policy "check_ins_insert_own"
  on public.check_ins for insert
  to authenticated
  with check (school_id = public.my_school_id() and profile_id = auth.uid());
-- No client update (the record is immutable) and no client delete (retention job only).

grant select on public.check_ins to authenticated;
grant insert on public.check_ins to authenticated;
