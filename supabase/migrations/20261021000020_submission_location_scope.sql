-- Migration: 20261021000020_submission_location_scope.sql
-- Fixes the insert denial that happened only when a submission carried a
-- location_id: the validation trigger read public.locations while the insert
-- policy was being evaluated, and the two interacted badly (the row was refused
-- with an RLS error even though every policy condition was true).
--
-- The location scope now lives in the policy as a single security-definer
-- helper, and the trigger no longer reads the locations table at all.

-- Helper: is this location usable for the caller's school?
create or replace function public.submittable_location(p_location_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.locations l
    where l.id = p_location_id
      and l.school_id = public.my_school_id()
      and l.status <> 'archived'
  );
$$;

comment on function public.submittable_location(uuid) is 'True when the location exists, belongs to the caller''s school and is not archived.';

revoke execute on function public.submittable_location(uuid) from public;
grant execute on function public.submittable_location(uuid) to authenticated;

-- Policy: a submission may only point at a location of the caller's school
drop policy if exists submissions_insert_own on public.submissions;
create policy "submissions_insert_own"
  on public.submissions for insert
  to authenticated
  with check (
    school_id = public.my_school_id()
    and submitted_by = auth.uid()
    and status = 'new'
    and (location_id is null or public.submittable_location(location_id))
  );

-- Trigger: no table read any more
create or replace function public.validate_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.submitted_by := coalesce(new.submitted_by, auth.uid());
    if new.submitted_by is distinct from auth.uid() then
      raise exception 'a submission must be sent by yourself';
    end if;
  end if;

  if new.kind = 'sentiment' then
    if new.stress_level is null then
      raise exception 'a sentiment submission needs a stress level';
    end if;
    if new.stress_level < 1 or new.stress_level > 5 then
      raise exception 'stress level must be between 1 and 5';
    end if;
  elsif new.stress_level is not null then
    raise exception 'a stress level only applies to sentiment submissions';
  end if;

  if char_length(new.message) < 3 or char_length(new.message) > 2000 then
    raise exception 'message must be between 3 and 2000 characters';
  end if;

  if new.status <> 'new' then
    raise exception 'new submissions must start as new';
  end if;

  return new;
end;
$$;

comment on function public.validate_submission() is 'Server-side submission validation: identity, kind/sub-type consistency, stress level rules, message length. Location scope is enforced by the insert policy.';
