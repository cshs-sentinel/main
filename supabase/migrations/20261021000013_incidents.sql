-- Migration: 20261021000013_incidents.sql
-- SOS / incident workflow (Phase 4, Task 4.1).
-- Workflow: new -> acknowledged -> assigned -> in_progress -> resolved -> closed
--           (+ cancelled = false alarm; history is never erased)
-- All status changes go through transition_incident(), which enforces roles and
-- writes the status history. Clients have NO update/delete rights on incidents.

-- ============================================================
-- 1. Case reference counter (server-side only)
-- ============================================================
create table public.incident_case_refs (
  year int primary key,
  last_value int not null default 0
);

alter table public.incident_case_refs enable row level security;
revoke all on public.incident_case_refs from anon, authenticated;

create or replace function public.next_case_ref()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_next int;
begin
  insert into public.incident_case_refs (year, last_value)
  values (v_year, 1)
  on conflict (year)
  do update set last_value = public.incident_case_refs.last_value + 1
  returning last_value into v_next;

  return 'SNT-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

comment on function public.next_case_ref() is 'Allocates the next case reference SNT-YYYY-#### (zero-padded, per calendar year).';

revoke execute on function public.next_case_ref() from public;
grant execute on function public.next_case_ref() to authenticated;

-- ============================================================
-- 2. incidents
-- ============================================================
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  case_ref text not null unique,
  school_id uuid not null references public.schools (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  status text not null default 'new',
  category text not null,
  description text not null,
  location_id uuid references public.locations (id),
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  assigned_to uuid references public.profiles (id),
  assigned_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_status check (status in ('new', 'acknowledged', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled')),
  constraint incidents_category check (category in ('emergency', 'medical', 'security', 'other')),
  constraint incidents_description check (char_length(description) between 3 and 2000),
  constraint incidents_case_ref_format check (case_ref ~ '^SNT-[0-9]{4}-[0-9]{4}$')
);

comment on table public.incidents is 'SOS / incident cases. Status changes only via transition_incident(); no client update or delete. Case reference SNT-YYYY-####.';
comment on column public.incidents.status is 'new -> acknowledged -> assigned -> in_progress -> resolved -> closed, plus cancelled (false alarm, history kept).';

create index idx_incidents_school on public.incidents (school_id);
create index idx_incidents_status on public.incidents (status);
create index idx_incidents_creator on public.incidents (created_by);
create index idx_incidents_created on public.incidents (created_at desc);

-- ============================================================
-- 3. Status history and response notes
-- ============================================================
create table public.incident_status_history (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);

comment on table public.incident_status_history is 'Append-only history of every incident status transition. Never deleted.';

create index idx_incident_history_incident on public.incident_status_history (incident_id, created_at);

create table public.incident_notes (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete restrict,
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  constraint incident_notes_body check (char_length(body) between 1 and 2000)
);

comment on table public.incident_notes is 'Response notes added by responders (and context notes by the creator). Append-only.';

create index idx_incident_notes_incident on public.incident_notes (incident_id, created_at);

-- ============================================================
-- 4. Validation trigger: case ref, identity, category, location, duplicate guard
-- ============================================================
create or replace function public.validate_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
  v_open record;
begin
  -- Case reference is always generated server-side
  new.case_ref := public.next_case_ref();

  if auth.uid() is not null then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.created_by is distinct from auth.uid() then
      raise exception 'incident must be raised by yourself';
    end if;
  end if;

  if new.category not in ('emergency', 'medical', 'security', 'other') then
    raise exception 'invalid incident category';
  end if;
  if char_length(new.description) < 3 or char_length(new.description) > 2000 then
    raise exception 'description must be between 3 and 2000 characters';
  end if;
  if new.status <> 'new' then
    raise exception 'new incidents must start as new';
  end if;

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

  -- Duplicate protection: one open incident per person per 5 minutes
  select i.id, i.case_ref into v_open
  from public.incidents i
  where i.created_by = new.created_by
    and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')
    and i.created_at > now() - interval '5 minutes'
  order by i.created_at desc
  limit 1;

  if found then
    raise exception 'you already have an open incident (%); please wait before raising another', v_open.case_ref;
  end if;

  return new;
end;
$$;

comment on function public.validate_incident() is 'Server-side incident validation: case reference, identity, category, location scope, duplicate guard (5 minutes).';

revoke execute on function public.validate_incident() from public;

create trigger incidents_validate
  before insert on public.incidents
  for each row execute function public.validate_incident();

create trigger incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

create trigger incidents_audit
  after insert or update or delete on public.incidents
  for each row execute function public.audit_school_structure('incidents');

create trigger incident_notes_audit
  after insert on public.incident_notes
  for each row execute function public.audit_school_structure('incident_notes');

-- ============================================================
-- 5. RLS: creator + responders/admins may read; only own incidents can be raised
-- ============================================================
alter table public.incidents enable row level security;
alter table public.incident_status_history enable row level security;
alter table public.incident_notes enable row level security;

create policy "incidents_select_creator_or_reviewer"
  on public.incidents for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and (created_by = auth.uid() or public.is_reviewer())
  );

create policy "incidents_insert_own"
  on public.incidents for insert
  to authenticated
  with check (school_id = public.my_school_id() and created_by = auth.uid());
-- No client update: status changes only through transition_incident().
-- No client delete: cases are retained.

create policy "incident_history_select_readable"
  on public.incident_status_history for select
  to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_id
    )
  );
-- Insert happens only inside transition_incident() (security definer).

create policy "incident_notes_select_readable"
  on public.incident_notes for select
  to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_id
    )
  );

create policy "incident_notes_insert_author"
  on public.incident_notes for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_id
        and (i.created_by = auth.uid() or public.is_reviewer())
    )
  );
-- No client update or delete on notes.

-- ============================================================
-- 6. transition_incident(): the only way to change status
-- ============================================================
create or replace function public.transition_incident(
  incident_id uuid,
  new_status text,
  note text default null
)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident_id uuid := incident_id;
  v_new_status text := new_status;
  v_note text := note;
  v_incident public.incidents%rowtype;
  v_old_status text;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
begin
  select * into v_incident from public.incidents where id = v_incident_id for update;
  if not found then
    raise exception 'incident not found';
  end if;
  if v_incident.school_id <> public.my_school_id() then
    raise exception 'incident belongs to a different school';
  end if;

  -- Allowed transitions and who may perform them
  if v_new_status = 'acknowledged' and v_incident.status = 'new' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'assigned' and v_incident.status = 'acknowledged' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'in_progress' and v_incident.status = 'assigned' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'resolved' and v_incident.status = 'in_progress' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'closed' and v_incident.status = 'resolved' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'cancelled'
        and v_incident.status in ('new', 'acknowledged', 'assigned', 'in_progress')
        and (v_incident.created_by = v_actor or public.is_admin()) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'transition % -> % is not allowed for your role', v_incident.status, v_new_status;
  end if;

  v_old_status := v_incident.status;

  update public.incidents
     set status = v_new_status,
         acknowledged_by = case when v_new_status = 'acknowledged' then v_actor else acknowledged_by end,
         acknowledged_at = case when v_new_status = 'acknowledged' then now() else acknowledged_at end,
         assigned_to = case when v_new_status = 'assigned' then coalesce(assigned_to, v_actor) else assigned_to end,
         assigned_at = case when v_new_status = 'assigned' then now() else assigned_at end,
         resolved_at = case when v_new_status = 'resolved' then now() else resolved_at end,
         resolution_notes = case when v_new_status = 'resolved' then coalesce(v_note, resolution_notes) else resolution_notes end,
         closed_at = case when v_new_status = 'closed' then now() else closed_at end,
         closed_by = case when v_new_status = 'closed' then v_actor else closed_by end,
         cancelled_at = case when v_new_status = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when v_new_status = 'cancelled' then v_actor else cancelled_by end,
         cancelled_reason = case when v_new_status = 'cancelled' then coalesce(v_note, 'no reason given') else cancelled_reason end,
         updated_at = now()
   where id = v_incident_id
  returning * into v_incident;

  insert into public.incident_status_history (incident_id, from_status, to_status, actor_id, note)
  values (v_incident_id, v_old_status, v_new_status, v_actor, v_note);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    v_actor,
    'incident_transition',
    'incidents',
    v_incident_id::text,
    jsonb_build_object('case_ref', v_incident.case_ref, 'from', v_old_status, 'to', v_new_status)
  );

  return v_incident;
end;
$$;

comment on function public.transition_incident(uuid, text, text) is 'Role-checked status transition for incidents. Writes status history and an audit row.';

revoke execute on function public.transition_incident(uuid, text, text) from public;
grant execute on function public.transition_incident(uuid, text, text) to authenticated;

-- ============================================================
-- 7. Grants
-- ============================================================
grant select on public.incidents to authenticated;
grant insert on public.incidents to authenticated;
grant select on public.incident_status_history to authenticated;
grant select, insert on public.incident_notes to authenticated;
