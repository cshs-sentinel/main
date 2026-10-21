-- Migration: 20261021000017_alert_workflow_flag.sql
-- Fixes the alert workflow: validate_alert() rejected EVERY status change, which
-- also blocked the server-side approve/publish/correct/cancel functions (they
-- update the status too). The workflow functions now set a transaction-local
-- flag that the trigger honours; clients still cannot change a status
-- directly, and only the author may edit a draft's content.

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

  -- UPDATE
  if new.status is distinct from old.status
     and coalesce(current_setting('app.alert_workflow', true), '') <> 'yes' then
    raise exception 'alert status can only change through the alert workflow';
  end if;
  if new.school_id is distinct from old.school_id
     or new.created_by is distinct from old.created_by
     or new.supersedes_id is distinct from old.supersedes_id
     or new.version is distinct from old.version then
    raise exception 'alert ownership fields cannot be changed';
  end if;

  -- Content of a published/approved/cancelled alert is frozen; only a draft can
  -- be edited, and only by its author.
  if old.status <> 'draft' and coalesce(current_setting('app.alert_workflow', true), '') <> 'yes' then
    raise exception 'only a draft alert can be edited';
  end if;
  if old.created_by is distinct from auth.uid() then
    raise exception 'only the author can edit this draft';
  end if;

  return new;
end;
$$;

comment on function public.validate_alert() is 'Server-side alert validation: author identity, draft-only editing, status changes only through the workflow functions (which set app.alert_workflow).';

-- ============================================================
-- Workflow functions, now setting the flag
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

  perform set_config('app.alert_workflow', 'yes', true);

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

  perform set_config('app.alert_workflow', 'yes', true);

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

  perform set_config('app.alert_workflow', 'yes', true);

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

  perform set_config('app.alert_workflow', 'yes', true);

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
