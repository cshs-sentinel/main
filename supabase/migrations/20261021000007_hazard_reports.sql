-- Migration: 20261021000007_hazard_reports.sql
-- Hazard reports: submission through authorized review (Phase 3).
-- Anyone in the school can file; responder/administrator review via status transitions.
-- No client delete. Optional private photo arrives with the storage task.
-- Categories are v1 hardcoded (facility_damage, safety_hazard, crowding, other).

-- ============================================================
-- 1. Table
-- ============================================================
create table public.hazard_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  reporter_id uuid not null default auth.uid() references public.profiles (id),
  location_id uuid references public.locations (id), -- optional context
  category text not null,
  description text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hazard_reports_category check (category in ('facility_damage', 'safety_hazard', 'crowding', 'other')),
  constraint hazard_reports_status check (status in ('open', 'acknowledged', 'resolved')),
  constraint hazard_reports_description check (char_length(description) between 3 and 2000)
);

comment on table public.hazard_reports is 'Facility/safety hazard reports. Own-school read for all roles; anyone may file own-school; responder/administrator review via status. No client delete.';
comment on column public.hazard_reports.status is 'open -> acknowledged -> resolved, plus one-step undo (acknowledged->open, resolved->acknowledged).';
comment on column public.hazard_reports.location_id is 'Optional expected-location context (schedule-derived areas are not proof of occupancy).';

create index idx_hazard_reports_school on public.hazard_reports (school_id);
create index idx_hazard_reports_status on public.hazard_reports (status);
create index idx_hazard_reports_created on public.hazard_reports (created_at);

-- ============================================================
-- 2. Helper: is_reviewer()
-- ============================================================
create or replace function public.is_reviewer()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('responder', 'administrator')
  );
$$;

comment on function public.is_reviewer() is 'Returns true when the current user is a responder or administrator (report reviewer).';

-- ============================================================
-- 3. Validation trigger: friendly messages, reporter identity,
--    location scoping, immutable details, status workflow
-- ============================================================
create or replace function public.validate_hazard_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
begin
  if tg_op = 'INSERT' then
    -- Identity: file as yourself (friendly message beats a raw RLS violation)
    if auth.uid() is not null then
      new.reporter_id := coalesce(new.reporter_id, auth.uid());
      if new.reporter_id is distinct from auth.uid() then
        raise exception 'report must be filed as yourself';
      end if;
    end if;
    if new.reporter_id is null then
      raise exception 'reporter is required';
    end if;

    -- Friendly constraint messages (run before raw check-constraint errors)
    if new.category not in ('facility_damage', 'safety_hazard', 'crowding', 'other') then
      raise exception 'invalid report category';
    end if;
    if char_length(new.description) < 3 or char_length(new.description) > 2000 then
      raise exception 'description must be between 3 and 2000 characters';
    end if;
    if new.status <> 'open' then
      raise exception 'new reports must start as open';
    end if;

    -- Optional location: exists, same school, not archived
    if new.location_id is not null then
      select * into v_location from public.locations where id = new.location_id;
      if not found then
        raise exception 'location not found';
      end if;
      if v_location.school_id <> new.school_id then
        raise exception 'location belongs to a different school';
      end if;
      if v_location.status = 'archived' then
        raise exception 'cannot report an archived location';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE (review path): details immutable, status follows the workflow
  if new.school_id is distinct from old.school_id
     or new.reporter_id is distinct from old.reporter_id
     or new.category is distinct from old.category
     or new.description is distinct from old.description
     or new.location_id is distinct from old.location_id
     or new.created_at is distinct from old.created_at then
    raise exception 'report details cannot be changed after submission';
  end if;

  if new.status is distinct from old.status
     and not ((old.status, new.status) in (
       ('open', 'acknowledged'),
       ('acknowledged', 'resolved'),
       ('acknowledged', 'open'),
       ('resolved', 'acknowledged')
     )) then
    raise exception 'invalid status transition (open -> acknowledged -> resolved)';
  end if;

  return new;
end;
$$;

comment on function public.validate_hazard_report() is 'Server-side report validation: reporter identity, friendly messages, location scoping, immutable details, status workflow.';

create trigger hazard_reports_validate
  before insert or update on public.hazard_reports
  for each row execute function public.validate_hazard_report();

-- ============================================================
-- 4. Triggers: updated_at, school immutability, audit
-- ============================================================
create trigger hazard_reports_set_updated_at
  before update on public.hazard_reports
  for each row execute function public.set_updated_at();

create trigger hazard_reports_no_school_reassign
  before update on public.hazard_reports
  for each row execute function public.prevent_school_reassign();

create trigger hazard_reports_audit
  after insert or update or delete on public.hazard_reports
  for each row execute function public.audit_school_structure('hazard_reports');

-- ============================================================
-- 5. RLS (own-school read; anyone files own-school as self;
--    reviewers update; no client delete)
-- ============================================================
alter table public.hazard_reports enable row level security;

create policy "hazard_reports_select_school"
  on public.hazard_reports for select
  to authenticated
  using (school_id = public.my_school_id());

create policy "hazard_reports_insert_own"
  on public.hazard_reports for insert
  to authenticated
  with check (school_id = public.my_school_id() and reporter_id = auth.uid());

create policy "hazard_reports_update_reviewers"
  on public.hazard_reports for update
  to authenticated
  using (public.is_reviewer() and school_id = public.my_school_id())
  with check (public.is_reviewer() and school_id = public.my_school_id());
-- No client delete: reports are retained for the audit trail.

-- ============================================================
-- 6. Grants (supabase defaults grant everything to authenticated;
--    no-delete is enforced by the ABSENCE of a delete policy)
-- ============================================================
grant select on public.hazard_reports to authenticated;
grant insert, update on public.hazard_reports to authenticated;
