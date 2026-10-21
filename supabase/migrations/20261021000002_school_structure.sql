-- Migration 0002: School structure (buildings, floors, rooms)
-- Phase 2 foundation for MCSI-08 SENTINEL
-- Scope: buildings > floors > rooms hierarchy, RLS, audit triggers
-- Spec: docs/ARCHITECTURE.md 4.2 — All authenticated read; admin write

-- 1. Table: buildings
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buildings is 'School buildings. All authenticated read; admin write.';

-- 2. Table: floors
create table public.floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floors_building_label_unique unique (building_id, label)
);

comment on table public.floors is 'Floors within a building. Label unique per building.';

-- 3. Table: rooms
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors (id) on delete cascade,
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rooms is 'Rooms within a floor. Code is a unique room identifier.';

-- 4. Profiles building assignment (column only; write path via future audited RPC)
alter table public.profiles
  add column building_id uuid references public.buildings (id) on delete set null;

comment on column public.profiles.building_id is 'Optional building assignment. Set only via admin RPC (future task).';

-- 5. Indexes
create index idx_floors_building_id on public.floors (building_id);
create index idx_rooms_floor_id on public.rooms (floor_id);
create index idx_profiles_building_id on public.profiles (building_id);

-- 6. Helper: updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger buildings_set_updated_at
  before update on public.buildings
  for each row execute function public.set_updated_at();

create trigger floors_set_updated_at
  before update on public.floors
  for each row execute function public.set_updated_at();

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- 7. Helper: audit structure changes (admin actions)
create or replace function public.audit_school_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    tg_argv[0],
    case tg_op when 'DELETE' then (old.id)::text else (new.id)::text end,
    case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.audit_school_structure() is 'Writes audit_logs row for school-structure CRUD. Entity type from TG_ARGV.';

create trigger buildings_audit
  after insert or update or delete on public.buildings
  for each row execute function public.audit_school_structure('buildings');

create trigger floors_audit
  after insert or update or delete on public.floors
  for each row execute function public.audit_school_structure('floors');

create trigger rooms_audit
  after insert or update or delete on public.rooms
  for each row execute function public.audit_school_structure('rooms');

-- 8. RLS: buildings / floors / rooms
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.rooms enable row level security;

-- Read: all authenticated users
create policy "buildings_select_authenticated"
  on public.buildings for select
  to authenticated
  using (true);

create policy "floors_select_authenticated"
  on public.floors for select
  to authenticated
  using (true);

create policy "rooms_select_authenticated"
  on public.rooms for select
  to authenticated
  using (true);

-- Write: administrators only
create policy "buildings_insert_admin"
  on public.buildings for insert
  to authenticated
  with check (public.is_admin());

create policy "buildings_update_admin"
  on public.buildings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "buildings_delete_admin"
  on public.buildings for delete
  to authenticated
  using (public.is_admin());

create policy "floors_insert_admin"
  on public.floors for insert
  to authenticated
  with check (public.is_admin());

create policy "floors_update_admin"
  on public.floors for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "floors_delete_admin"
  on public.floors for delete
  to authenticated
  using (public.is_admin());

create policy "rooms_insert_admin"
  on public.rooms for insert
  to authenticated
  with check (public.is_admin());

create policy "rooms_update_admin"
  on public.rooms for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "rooms_delete_admin"
  on public.rooms for delete
  to authenticated
  using (public.is_admin());

-- 9. Grants (RLS policies gate who may write; grants enable PostgREST verbs)
grant select on public.buildings to authenticated;
grant insert, update, delete on public.buildings to authenticated;
grant select on public.floors to authenticated;
grant insert, update, delete on public.floors to authenticated;
grant select on public.rooms to authenticated;
grant insert, update, delete on public.rooms to authenticated;
-- profiles already granted select in 0001; building_id readable via own-row policy
