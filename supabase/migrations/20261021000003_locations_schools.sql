-- Migration 0003: Multi-school foundation + unified locations module
-- Phase 2 for MCSI-08 SENTINEL
-- Approved decisions (user, this phase):
--   A. Multi-school scoping now (schools table + school_id + per-school RLS)
--   B. Unified hierarchical `locations` replacing buildings/floors/rooms
--   C. Archive-only: no client DELETE on locations/categories
-- Verified before writing: public.buildings/floors/rooms row counts = 0 (safe drop)
-- Spec updated in docs/ARCHITECTURE.md (sections 4.1-4.3)

-- ============================================================
-- 1. schools
-- ============================================================
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.schools is 'Schools/campuses. Seeded default school; additional schools via SQL/dashboard only.';

-- Seed: single default school (synthetic name, fixed id for stable FKs)
insert into public.schools (id, name)
values ('11111111-1111-1111-1111-111111111111', 'SENTINEL Test School');

-- ============================================================
-- 2. profiles: school scoping; retire building_id (empty), add primary_location_id
-- ============================================================
alter table public.profiles
  add column school_id uuid not null default '11111111-1111-1111-1111-111111111111'
  references public.schools (id);

comment on column public.profiles.school_id is 'School membership. New signups land in default school; assignment via admin RPC (future).';

-- ============================================================
-- 3. Helper: my_school_id()
-- ============================================================
create or replace function public.my_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

comment on function public.my_school_id() is 'School of the current user (security definer; avoids RLS recursion).';

-- ============================================================
-- 4. location_categories (school-configurable, not hardcoded)
-- ============================================================
create table public.location_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  name text not null,
  environment text not null default 'either'
    check (environment in ('indoor', 'outdoor', 'either')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.location_categories is 'Configurable location types per school. Deactivate via is_active (no delete).';
comment on column public.location_categories.environment is 'Which environments this category may label: indoor, outdoor, or either.';

create unique index location_categories_school_name_unique
  on public.location_categories (school_id, lower(name));

-- Seed categories (editable DATA, not hardcoded logic) — before audit triggers to avoid seed noise
insert into public.location_categories (school_id, name, environment) values
  ('11111111-1111-1111-1111-111111111111', 'Building', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Floor', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Room', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Classroom', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Laboratory', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Office', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Library', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Clinic', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Canteen', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Restroom', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Corridor', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Lobby', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Storage', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Auditorium', 'indoor'),
  ('11111111-1111-1111-1111-111111111111', 'Garden', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Park', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Open Space', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Tree Zone', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Playground', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Sports Field', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Walkway', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Parking', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Gate', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Assembly Ground', 'outdoor'),
  ('11111111-1111-1111-1111-111111111111', 'Court', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Gym', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Covered Court', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Plaza', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Drop-off Point', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Maintenance Area', 'either'),
  ('11111111-1111-1111-1111-111111111111', 'Utility Area', 'either');

-- ============================================================
-- 5. locations (unified hierarchy: indoor + outdoor + custom)
-- ============================================================
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  parent_id uuid references public.locations (id),
  category_id uuid not null references public.location_categories (id),
  name text not null,
  code text,
  description text,
  environment text not null default 'indoor'
    check (environment in ('indoor', 'outdoor', 'covered')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  access_level text not null default 'staff'
    check (access_level in ('public', 'staff', 'restricted')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.locations is 'Unified school locations. parent_id optional (outdoor/custom may be top-level). Archive via status; no client delete.';
comment on column public.locations.parent_id is 'Optional parent. Validated: same school, not archived, no cycles, depth <= 100.';
comment on column public.locations.status is 'active | inactive | archived. Historical FK references stay valid; prefer archive over delete.';

create index idx_locations_school on public.locations (school_id);
create index idx_locations_parent on public.locations (parent_id);
create index idx_locations_category on public.locations (category_id);

-- Duplicate code rule: unique per school among non-archived rows (NULL codes exempt)
create unique index locations_school_code_unique
  on public.locations (school_id, code)
  where code is not null and status <> 'archived';

-- profiles: retire building_id (no data), add primary_location_id
alter table public.profiles drop column if exists building_id;
alter table public.profiles
  add column primary_location_id uuid references public.locations (id) on delete set null;

comment on column public.profiles.primary_location_id is 'Optional primary location (e.g. home building). Set via audited admin RPC (future).';

-- ============================================================
-- 6. Triggers: updated_at, school immutability, validation, audit
-- ============================================================
-- updated_at (set_updated_at exists from 0002)
create trigger schools_set_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
  before update on public.location_categories
  for each row execute function public.set_updated_at();

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- school_id immutable (prevents unauthorized cross-school reassignment)
create or replace function public.prevent_school_reassign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.school_id <> old.school_id then
    raise exception 'school reassignment is not allowed';
  end if;
  return new;
end;
$$;

create trigger locations_no_school_reassign
  before update on public.locations
  for each row execute function public.prevent_school_reassign();

create trigger categories_no_school_reassign
  before update on public.location_categories
  for each row execute function public.prevent_school_reassign();

-- Location validation: parent, cycle, category, duplicates
create or replace function public.validate_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.locations%rowtype;
  v_category public.location_categories%rowtype;
  v_count bigint;
begin
  -- Accurate audit actor
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  -- Parent validation
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a location cannot be its own parent';
    end if;
    select * into v_parent from public.locations where id = new.parent_id;
    if not found then
      raise exception 'parent location not found';
    end if;
    if v_parent.school_id <> new.school_id then
      raise exception 'parent belongs to a different school';
    end if;
    if v_parent.status = 'archived' then
      raise exception 'cannot add or move locations under an archived parent';
    end if;
  end if;

  -- Cycle + depth check (relevant on parent change)
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    null; -- parent unchanged: skip walk
  elsif new.parent_id is not null then
    with recursive chain (depth, id, parent_id) as (
      select 0, id, parent_id from public.locations where id = new.parent_id
      union all
      select c.depth + 1, l.id, l.parent_id
      from public.locations l join chain c on l.id = c.parent_id
      where c.depth < 101
    )
    select count(*) into v_count from chain where id = new.id;
    if v_count > 0 then
      raise exception 'parent change would create a cycle';
    end if;
    select count(*) into v_count from chain where depth >= 101;
    if v_count > 0 then
      raise exception 'location hierarchy depth limit exceeded';
    end if;
  end if;

  -- Category validation
  select * into v_category from public.location_categories where id = new.category_id;
  if not found then
    raise exception 'category not found';
  end if;
  if v_category.school_id <> new.school_id then
    raise exception 'category belongs to a different school';
  end if;
  if not v_category.is_active and tg_op = 'INSERT' then
    raise exception 'category is inactive';
  end if;
  if v_category.environment <> 'either' and v_category.environment <> new.environment then
    raise exception 'category % may not label an % location', v_category.name, new.environment;
  end if;

  -- Sibling duplicate name (case-insensitive, non-archived, same parent)
  select count(*) into v_count
  from public.locations
  where school_id = new.school_id
    and lower(name) = lower(new.name)
    and status <> 'archived'
    and id <> new.id
    and parent_id is not distinct from new.parent_id;
  if v_count > 0 then
    raise exception 'a location named "%" already exists under this parent', new.name;
  end if;

  -- Duplicate code (friendly message; backstopped by partial unique index)
  if new.code is not null and new.status <> 'archived' then
    select count(*) into v_count
    from public.locations
    where school_id = new.school_id
      and code = new.code
      and status <> 'archived'
      and id <> new.id;
    if v_count > 0 then
      raise exception 'code "%" is already used in this school', new.code;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_location() is 'Server-side location validation: parent, cycle, depth, category, duplicates.';

create trigger locations_validate
  before insert or update on public.locations
  for each row execute function public.validate_location();

-- Audit (audit_school_structure exists from 0002; entity type via TG_ARGV)
create trigger schools_audit
  after insert or update or delete on public.schools
  for each row execute function public.audit_school_structure('schools');

create trigger categories_audit
  after insert or update or delete on public.location_categories
  for each row execute function public.audit_school_structure('location_categories');

create trigger locations_audit
  after insert or update or delete on public.locations
  for each row execute function public.audit_school_structure('locations');

-- ============================================================
-- 7. RLS
-- ============================================================
-- schools
alter table public.schools enable row level security;

create policy "schools_select_own"
  on public.schools for select
  to authenticated
  using (id = public.my_school_id());

create policy "schools_update_admin"
  on public.schools for update
  to authenticated
  using (public.is_admin() and id = public.my_school_id())
  with check (public.is_admin() and id = public.my_school_id());
-- No client insert/delete on schools (provisioned via SQL/dashboard).

-- location_categories
alter table public.location_categories enable row level security;

create policy "categories_select_school"
  on public.location_categories for select
  to authenticated
  using (school_id = public.my_school_id());

create policy "categories_insert_admin"
  on public.location_categories for insert
  to authenticated
  with check (public.is_admin() and school_id = public.my_school_id());

create policy "categories_update_admin"
  on public.location_categories for update
  to authenticated
  using (public.is_admin() and school_id = public.my_school_id())
  with check (public.is_admin() and school_id = public.my_school_id());
-- No client delete (deactivate via is_active).

-- locations
alter table public.locations enable row level security;

create policy "locations_select_school"
  on public.locations for select
  to authenticated
  using (school_id = public.my_school_id());

create policy "locations_insert_admin"
  on public.locations for insert
  to authenticated
  with check (public.is_admin() and school_id = public.my_school_id());

create policy "locations_update_admin"
  on public.locations for update
  to authenticated
  using (public.is_admin() and school_id = public.my_school_id())
  with check (public.is_admin() and school_id = public.my_school_id());
-- No client delete: archive-only (approved decision C).

-- profiles: admin read restricted to own school
drop policy if exists profiles_select_admin on public.profiles;
create policy "profiles_select_admin"
  on public.profiles for select
  to authenticated
  using (public.is_admin() and school_id = public.my_school_id());

-- audit_logs: admin read restricted to own-school actors (prevents cross-school payload leak)
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (
    public.is_admin()
    and actor_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = actor_id and p.school_id = public.my_school_id()
    )
  );

-- ============================================================
-- 8. Grants (RLS gates who; grants gate which verbs exist at all)
-- ============================================================
grant select on public.schools to authenticated;
grant update on public.schools to authenticated;
grant select on public.location_categories to authenticated;
grant insert, update on public.location_categories to authenticated;
grant select on public.locations to authenticated;
grant insert, update on public.locations to authenticated;
-- No delete grants on locations/categories/schools => archive-only enforced at grant level.

-- ============================================================
-- 9. Retire buildings / floors / rooms (verified empty before push)
-- ============================================================
drop trigger if exists rooms_audit on public.rooms;
drop trigger if exists rooms_set_updated_at on public.rooms;
drop table if exists public.rooms;

drop trigger if exists floors_audit on public.floors;
drop trigger if exists floors_set_updated_at on public.floors;
drop table if exists public.floors;

drop trigger if exists buildings_audit on public.buildings;
drop trigger if exists buildings_set_updated_at on public.buildings;
drop table if exists public.buildings;
