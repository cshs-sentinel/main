-- Migration 0004: Fix validate_location archived-parent check
-- Bug: parent-archived check ran on every INSERT/UPDATE, so updating a row
-- under an archived parent (e.g. archiving children after a parent) failed.
-- Fix: only enforce when the parent relationship is actually being set/changed.
-- Uses `new.parent_id is distinct from old.parent_id` which is TRUE on INSERT
-- (old.parent_id is NULL) and on UPDATE only when parent changes.

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
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

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
    if v_parent.status = 'archived' and new.parent_id is distinct from old.parent_id then
      raise exception 'cannot add or move locations under an archived parent';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    null;
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
