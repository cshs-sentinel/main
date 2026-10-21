-- Migration: 20261021000016_alerts.sql
-- In-app alerts (Phase 7, Task 7.1).
-- OFFICIAL announcements follow a human-gated workflow:
--   draft -> approved -> published, with correction (new version, old retained)
--   and cancellation (retained, with a reason).
-- Only administrators may approve, publish, correct or cancel; clients can never
-- set an alert to "published" themselves.
--
-- Operational case notifications (a new incident) are a SEPARATE, lighter table
-- (incident_notifications) so an automatic system row can never be mistaken for
-- an approved official announcement (docs/ARCHITECTURE.md section 6.2).
--
-- No external delivery (no SMS/email/push). Nothing here may be described as
-- "delivered" - an alert is only ever "published in the app".

-- ============================================================
-- 1. alerts
-- ============================================================
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  title text not null,
  body text not null,
  severity text not null default 'advisory',
  status text not null default 'draft',
  target_scope text not null default 'all',
  target_role public.app_role,
  created_by uuid not null default auth.uid() references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  published_by uuid references public.profiles (id),
  published_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  supersedes_id uuid references public.alerts (id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alerts_title check (char_length(title) between 3 and 160),
  constraint alerts_body check (char_length(body) between 3 and 2000),
  constraint alerts_severity check (severity in ('info', 'advisory', 'urgent')),
  constraint alerts_status check (status in ('draft', 'approved', 'published', 'corrected', 'cancelled')),
  constraint alerts_target_scope check (target_scope in ('all', 'role', 'responders')),
  constraint alerts_target_role check (target_scope <> 'role' or target_role is not null),
  constraint alerts_version check (version >= 1)
);

comment on table public.alerts is 'Official in-app announcements. Status changes only through the server functions (approve/publish/correct/cancel); no client delete; corrections create a new version and retain the old row.';
comment on column public.alerts.status is 'draft -> approved -> published; corrected (superseded by a newer version); cancelled (retained with a reason).';
comment on column public.alerts.target_scope is 'all = every signed-in member of the school; role = one role (plus reviewers for oversight); responders = responders and administrators.';
comment on column public.alerts.severity is 'info | advisory | urgent. A label for humans, never an automatic action.';

create index idx_alerts_school_status on public.alerts (school_id, status);
create index idx_alerts_published on public.alerts (published_at desc);
create index idx_alerts_created on public.alerts (created_by);

-- ============================================================
-- 2. incident_notifications (automatic, operational, reviewer-only)
-- ============================================================
create table public.incident_notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  case_ref text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

comment on table public.incident_notifications is 'Automatic notification that a new incident case was raised. Reviewer-only; not an official announcement and never an external message.';

create index idx_incident_notifications_school on public.incident_notifications (school_id, created_at desc);

-- ============================================================
-- 3. Validation: a client may only edit a draft's content
-- ============================================================
create or replace function public.validate_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := coalesce(new.created_by, auth.uid());
      if new.created_by is distinct from auth.uid() then
        raise exception 'an alert must be created by yourself';
      end if;
    end if;
    if new.status <> 'draft' then
      raise exception 'new alerts must start as a draft';
    end if;
    return new;
  end if;

  -- UPDATE (client path): only the author may edit a draft's content
  if new.status is distinct from old.status then
    raise exception 'alert status can only change through the alert workflow';
  end if;
  if new.school_id is distinct from old.school_id
     or new.created_by is distinct from old.created_by
     or new.supersedes_id is distinct from old.supersedes_id
     or new.version is distinct from old.version then
    raise exception 'alert ownership fields cannot be changed';
  end if;
  if old.status <> 'draft' then
    raise exception 'only a draft alert can be edited';
  end if;
  if old.created_by is distinct from auth.uid() then
    raise exception 'only the author can edit this draft';
  end if;

  return new;
end;
$$;

comment on function public.validate_alert() is 'Server-side alert validation: author identity, draft-only editing, status changes only via the workflow functions.';

revoke execute on function public.validate_alert() from public;

create trigger alerts_validate
  before insert or update on public.alerts
  for each row execute function public.validate_alert();

create trigger alerts_set_updated_at
  before update on public.alerts
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Workflow functions (the only way to publish, correct or cancel)
-- ============================================================
create or replace function public.approve_alert(alert_id uuid)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts%rowtype;
  v_actor uuid := auth.uid();
begin
  select * into v_alert from public.alerts where id = alert_id for update;
  if not found then
    raise exception 'alert not found';
  end if;
  if not public.is_admin() then
    raise exception 'only administrators may approve alerts';
  end if;
  if v_alert.status <> 'draft' then
    raise exception 'only a draft alert can be approved';
  end if;

  update public.alerts
     set status = 'approved', approved_by = v_actor, approved_at = now(), updated_at = now()
   where id = alert_id
  returning * into v_alert;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'alert_approved', 'alerts', alert_id::text,
          jsonb_build_object('title', v_alert.title, 'version', v_alert.version));

  return v_alert;
end;
$$;

create or replace function public.publish_alert(alert_id uuid)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts%rowtype;
  v_actor uuid := auth.uid();
begin
  select * into v_alert from public.alerts where id = alert_id for update;
  if not found then
    raise exception 'alert not found';
  end if;
  if not public.is_admin() then
    raise exception 'only administrators may publish alerts';
  end if;
  if v_alert.status <> 'approved' then
    raise exception 'an alert must be approved before it can be published';
  end if;

  update public.alerts
     set status = 'published', published_by = v_actor, published_at = now(), updated_at = now()
   where id = alert_id
  returning * into v_alert;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'alert_published', 'alerts', alert_id::text,
          jsonb_build_object('title', v_alert.title, 'version', v_alert.version,
                             'target_scope', v_alert.target_scope, 'target_role', v_alert.target_role));

  return v_alert;
end;
$$;

create or replace function public.correct_alert(
  alert_id uuid,
  new_title text,
  new_body text,
  reason text
)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts%rowtype;
  v_new public.alerts%rowtype;
  v_actor uuid := auth.uid();
begin
  select * into v_alert from public.alerts where id = alert_id for update;
  if not found then
    raise exception 'alert not found';
  end if;
  if not public.is_admin() then
    raise exception 'only administrators may correct alerts';
  end if;
  if v_alert.status <> 'published' then
    raise exception 'only a published alert can be corrected';
  end if;
  if char_length(coalesce(new_title, '')) < 3 or char_length(coalesce(new_body, '')) < 3 then
    raise exception 'a correction needs a title and a body';
  end if;

  -- The old row is retained and marked corrected; the correction is a new draft
  -- that has to go through approval and publication again.
  update public.alerts
     set status = 'corrected', updated_at = now()
   where id = alert_id;

  insert into public.alerts (
    school_id, title, body, severity, status, target_scope, target_role,
    created_by, supersedes_id, version
  ) values (
    v_alert.school_id, new_title, new_body, v_alert.severity, 'draft',
    v_alert.target_scope, v_alert.target_role, v_actor, alert_id, v_alert.version + 1
  )
  returning * into v_new;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'alert_corrected', 'alerts', alert_id::text,
          jsonb_build_object('reason', reason, 'new_alert_id', v_new.id::text,
                             'version', v_new.version));

  return v_new;
end;
$$;

create or replace function public.cancel_alert(alert_id uuid, reason text)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts%rowtype;
  v_actor uuid := auth.uid();
begin
  select * into v_alert from public.alerts where id = alert_id for update;
  if not found then
    raise exception 'alert not found';
  end if;
  if not (public.is_admin() or (v_alert.status = 'draft' and v_alert.created_by = v_actor)) then
    raise exception 'only administrators may cancel a published alert';
  end if;
  if v_alert.status in ('cancelled', 'corrected') then
    raise exception 'this alert is already closed';
  end if;

  update public.alerts
     set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(),
         cancel_reason = coalesce(reason, 'no reason given'), updated_at = now()
   where id = alert_id
  returning * into v_alert;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'alert_cancelled', 'alerts', alert_id::text,
          jsonb_build_object('reason', v_alert.cancel_reason, 'title', v_alert.title));

  return v_alert;
end;
$$;

revoke execute on function public.approve_alert(uuid) from public;
revoke execute on function public.publish_alert(uuid) from public;
revoke execute on function public.correct_alert(uuid, text, text, text) from public;
revoke execute on function public.cancel_alert(uuid, text) from public;
grant execute on function public.approve_alert(uuid) to authenticated;
grant execute on function public.publish_alert(uuid) to authenticated;
grant execute on function public.correct_alert(uuid, text, text, text) to authenticated;
grant execute on function public.cancel_alert(uuid, text) to authenticated;

-- ============================================================
-- 5. New-case notification (automatic, reviewer-only)
-- ============================================================
create or replace function public.notify_new_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'new' then
    insert into public.incident_notifications (school_id, incident_id, case_ref, title, body)
    values (
      new.school_id,
      new.id,
      new.case_ref,
      'New case ' || new.case_ref,
      left(new.description, 200)
    );
  end if;
  return new;
end;
$$;

comment on function public.notify_new_incident() is 'Creates an operational notification when a case is raised. Reviewer-only; not an official announcement.';

revoke execute on function public.notify_new_incident() from public;

create trigger incidents_notify
  after insert on public.incidents
  for each row execute function public.notify_new_incident();

-- ============================================================
-- 6. RLS
-- ============================================================

-- Helper: the caller's application role (used for role-targeted alerts)
create or replace function public.my_role()
returns public.app_role
language sql
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

comment on function public.my_role() is 'Application role of the current user (student, teacher_staff, responder, administrator).';

revoke execute on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

alter table public.alerts enable row level security;
alter table public.incident_notifications enable row level security;

-- Published alerts: audience-scoped. Reviewers see everything in their school
-- for oversight; everybody else sees 'all' alerts and role-targeted ones for
-- their own role. Unpublished rows: author and reviewers only.
create policy "alerts_select_audience"
  on public.alerts for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and (
      (
        status = 'published'
        and (
          target_scope = 'all'
          or (target_scope = 'role' and (target_role = public.my_role() or public.is_reviewer()))
          or (target_scope = 'responders' and public.is_reviewer())
        )
      )
      or (status <> 'published' and (created_by = auth.uid() or public.is_reviewer()))
    )
  );

-- Only responders/administrators may draft an alert, and only as themselves.
create policy "alerts_insert_staff"
  on public.alerts for insert
  to authenticated
  with check (
    public.is_reviewer()
    and school_id = public.my_school_id()
    and created_by = auth.uid()
    and status = 'draft'
  );

-- Only the author may edit their own draft (status changes are impossible here).
create policy "alerts_update_own_draft"
  on public.alerts for update
  to authenticated
  using (created_by = auth.uid() and status = 'draft')
  with check (created_by = auth.uid() and status = 'draft');
-- No client delete: published alerts and their corrections are retained.

-- Operational case notifications: reviewers only.
create policy "incident_notifications_select_reviewers"
  on public.incident_notifications for select
  to authenticated
  using (school_id = public.my_school_id() and public.is_reviewer());
-- No client insert/update/delete: the trigger writes them.

grant select on public.alerts to authenticated;
grant insert, update on public.alerts to authenticated;
grant select on public.incident_notifications to authenticated;
