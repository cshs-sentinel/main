-- Migration: 20261021000006_schedules.sql
-- Effective-dated weekly schedules: which location is EXPECTED at which time.
-- A schedule row is a plan, not proof of occupancy (AGENTS.md section 5).
-- Conflicts (overlapping active times per location+day) are rejected server-side.

-- ============================================================
-- 1. schedules
-- ============================================================
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  location_id uuid not null references public.locations (id),
  day_of_week int not null check (day_of_week between 0 and 6), -- 0 = Sunday .. 6 = Saturday (JS convention)
  start_time time not null,
  end_time time not null,
  effective_from date not null default current_date,
  effective_until date, -- NULL = open-ended
  label text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_time_order check (end_time > start_time),
  constraint schedules_effective_order check (effective_until is null or effective_until >= effective_from)
);

comment on table public.schedules is 'Weekly effective-dated schedules. Expected locations only — never presented as verified occupancy. No client delete (deactivate via status).';
comment on column public.schedules.effective_until is 'Last valid date (inclusive). NULL = open-ended.';
comment on column public.schedules.status is 'active | inactive. Conflict checks consider active rows only.';

create index idx_schedules_school on public.schedules (school_id);
create index idx_schedules_location on public.schedules (location_id);

-- ============================================================
-- 2. Validation trigger: location checks + overlap conflicts
-- ============================================================
create or replace function public.validate_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
  v_count bigint;
begin
  -- Accurate audit actor
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  -- Friendly time / effective-range messages (run before constraint checks)
  if new.end_time <= new.start_time then
    raise exception 'end time must be after start time';
  end if;
  if new.effective_until is not null and new.effective_until < new.effective_from then
    raise exception 'effective until must be on or after effective from';
  end if;

  -- Location checks when the reference is new or changes
  if tg_op = 'INSERT' or new.location_id is distinct from old.location_id then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status = 'archived' then
      raise exception 'cannot schedule an archived location';
    end if;
  end if;

  -- Overlap conflict: only among active rows on the same location + weekday.
  -- Effective ranges must also intersect (NULL bound = open-ended = infinite).
  if new.status = 'active' then
    select count(*) into v_count
    from public.schedules
    where location_id = new.location_id
      and day_of_week = new.day_of_week
      and status = 'active'
      and id <> new.id
      and start_time < new.end_time
      and end_time > new.start_time
      and daterange(effective_from, effective_until, '[]')
        && daterange(new.effective_from, new.effective_until, '[]');
    if v_count > 0 then
      raise exception 'overlaps an existing active schedule for this location and day';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_schedule() is 'Server-side schedule validation: friendly messages, location scoping, active-overlap conflicts.';

create trigger schedules_validate
  before insert or update on public.schedules
  for each row execute function public.validate_schedule();

-- ============================================================
-- 3. Triggers: updated_at, school immutability, audit
-- ============================================================
create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();

create trigger schedules_no_school_reassign
  before update on public.schedules
  for each row execute function public.prevent_school_reassign();

create trigger schedules_audit
  after insert or update or delete on public.schedules
  for each row execute function public.audit_school_structure('schedules');

-- ============================================================
-- 4. RLS (own-school read for all roles; admin write; no client delete)
-- ============================================================
alter table public.schedules enable row level security;

create policy "schedules_select_school"
  on public.schedules for select
  to authenticated
  using (school_id = public.my_school_id());

create policy "schedules_insert_admin"
  on public.schedules for insert
  to authenticated
  with check (public.is_admin() and school_id = public.my_school_id());

create policy "schedules_update_admin"
  on public.schedules for update
  to authenticated
  using (public.is_admin() and school_id = public.my_school_id())
  with check (public.is_admin() and school_id = public.my_school_id());
-- No client delete (deactivate via status).

-- ============================================================
-- 5. Grants (supabase defaults grant everything to authenticated;
--    archive-only is enforced by the ABSENCE of a delete policy)
-- ============================================================
grant select on public.schedules to authenticated;
grant insert, update on public.schedules to authenticated;
