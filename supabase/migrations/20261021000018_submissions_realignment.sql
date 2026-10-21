-- Migration: 20261021000018_submissions_realignment.sql
-- Realignment (2026-10-21): one submission intake for the school's four data
-- categories, with a strict access model.
--
-- Categories (as specified by the school):
--   sentiment       - emotions, concerns, stress, well-being
--   incident_hazard - bullying, unsafe conditions, suspicious activities
--   observation     - suggestions, reports, safety concerns
--   emergency       - fire, injury, accidents, immediate threats
--                    (emergencies are raised through the SOS flow and live in
--                     public.incidents, which carries the case reference,
--                     assignment, history and notes)
--
-- Access model (as specified by the school):
--   * students may SUBMIT only - they cannot read submissions, not even their
--     own, and they cannot modify or delete them;
--   * administrators and staff (teacher_staff, responder, administrator) read
--     and review submissions, including individual wellbeing entries;
--   * no client delete anywhere - submissions are retained for the record.

-- ============================================================
-- 1. Reshape hazard_reports into submissions
-- ============================================================
alter table public.hazard_reports rename to submissions;

-- Retire the old validation, audit and timestamp triggers first: they reference
-- the old column names / entity type and would fire (and fail) during the data
-- migration below.
drop trigger if exists hazard_reports_validate on public.submissions;
drop trigger if exists hazard_reports_audit on public.submissions;
drop trigger if exists hazard_reports_set_updated_at on public.submissions;
drop trigger if exists hazard_reports_no_school_reassign on public.submissions;
drop function if exists public.validate_hazard_report();

-- The old column names describe the previous model; keep the same data.
alter table public.submissions rename column reporter_id to submitted_by;
alter table public.submissions rename column description to message;

alter table public.submissions
  add column kind text not null default 'incident_hazard',
  add column sub_type text not null default 'unsafe_condition',
  add column emotion text,
  add column stress_level int,
  add column acknowledged_by uuid references public.profiles (id),
  add column acknowledged_at timestamptz,
  add column assigned_to uuid references public.profiles (id),
  add column resolved_at timestamptz,
  add column resolution_note text;

-- Map the old categories onto the new taxonomy, then retire the old column
update public.submissions
   set kind = 'observation', sub_type = 'safety_concern'
 where category = 'facility_damage';
update public.submissions
   set kind = 'incident_hazard', sub_type = 'unsafe_condition'
 where category = 'safety_hazard';
update public.submissions
   set kind = 'observation', sub_type = 'report'
 where category = 'crowding';
update public.submissions
   set kind = 'observation', sub_type = 'suggestion'
 where category = 'other';

-- The old workflow called the first stage "open"; the new one calls it "new".
-- The old constraint has to go first, it does not allow the new value.
alter table public.submissions drop constraint hazard_reports_status;
update public.submissions set status = 'new' where status = 'open';

alter table public.submissions drop column category;

-- The category constraint went with the category column above.
alter table public.submissions drop constraint hazard_reports_description;
alter table public.submissions
  add constraint submissions_kind check (kind in ('sentiment', 'incident_hazard', 'observation')),
  add constraint submissions_status check (status in ('new', 'acknowledged', 'resolved')),
  add constraint submissions_stress_level check (stress_level is null or stress_level between 1 and 5),
  add constraint submissions_sub_type check (
    (kind = 'sentiment' and sub_type in ('joy', 'calm', 'worried', 'sad', 'angry', 'stressed', 'hopeless', 'lonely'))
    or (kind = 'incident_hazard' and sub_type in ('bullying', 'unsafe_condition', 'suspicious_activity'))
    or (kind = 'observation' and sub_type in ('suggestion', 'report', 'safety_concern'))
  );

comment on table public.submissions is 'Intake for the school''s data categories: sentiment (well-being), incident_hazard and observation. Emergencies are raised through the SOS flow (public.incidents). Students may submit only; staff read and review.';
comment on column public.submissions.kind is 'sentiment | incident_hazard | observation (emergencies live in public.incidents).';
comment on column public.submissions.sub_type is 'Refined category: emotion for sentiment, bullying/unsafe_condition/suspicious_activity for incident_hazard, suggestion/report/safety_concern for observation.';
comment on column public.submissions.stress_level is 'Self-reported stress level 1 (low) to 5 (high). Only for sentiment submissions.';
comment on column public.submissions.status is 'new -> acknowledged -> resolved (staff review).';

create index idx_submissions_school_status on public.submissions (school_id, status);
create index idx_submissions_kind on public.submissions (kind, created_at desc);
create index idx_submissions_submitter on public.submissions (submitted_by);

-- ============================================================
-- 2. Validation trigger
-- ============================================================
create or replace function public.validate_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
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

  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status = 'archived' then
      raise exception 'cannot submit against an archived location';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_submission() is 'Server-side submission validation: identity, kind/sub-type consistency, stress level rules, message length, location scope.';

revoke execute on function public.validate_submission() from public;

drop trigger if exists hazard_reports_validate on public.submissions;
create trigger submissions_validate
  before insert on public.submissions
  for each row execute function public.validate_submission();

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

create trigger submissions_no_school_reassign
  before update on public.submissions
  for each row execute function public.prevent_school_reassign();

create trigger submissions_audit
  after insert or update or delete on public.submissions
  for each row execute function public.audit_school_structure('submissions');

-- ============================================================
-- 3. RLS: students submit only; staff read and review
-- ============================================================
drop policy if exists hazard_reports_select_school on public.submissions;
drop policy if exists hazard_reports_insert_own on public.submissions;
drop policy if exists hazard_reports_update_reviewers on public.submissions;

-- Any signed-in member may submit, for their own school, as themselves.
create policy "submissions_insert_own"
  on public.submissions for insert
  to authenticated
  with check (school_id = public.my_school_id() and submitted_by = auth.uid() and status = 'new');

-- Only staff read submissions (a student cannot read their own either).
create policy "submissions_select_staff"
  on public.submissions for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );

-- Staff review: acknowledge, assign, resolve.
create policy "submissions_update_staff"
  on public.submissions for update
  to authenticated
  using (
    school_id = public.my_school_id()
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  )
  with check (
    school_id = public.my_school_id()
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );
-- No client delete: submissions are retained.

grant select on public.submissions to authenticated;
grant insert, update on public.submissions to authenticated;

-- The report-photos policies follow the renamed table (relation references are
-- by OID), but their intent changes with it: only staff read report media now.
drop policy if exists report_photos_select_authorized on storage.objects;
drop policy if exists report_photos_insert_own on storage.objects;
drop policy if exists report_photos_delete_own on storage.objects;

create policy "report_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.school_id::text = (storage.foldername(name))[1]
        and s.submitted_by = auth.uid()
    )
  );

create policy "report_photos_select_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.school_id::text = (storage.foldername(name))[1]
    )
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );

create policy "report_photos_delete_staff"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'report-photos'
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.school_id::text = (storage.foldername(name))[1]
    )
  );

-- Attachments follow the renamed table as well
drop policy if exists report_attachments_select_report_scope on public.report_attachments;
drop policy if exists report_attachments_insert_reporter on public.report_attachments;
drop policy if exists report_attachments_delete_own on public.report_attachments;

create policy "report_attachments_select_staff"
  on public.report_attachments for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );

create policy "report_attachments_insert_owner"
  on public.report_attachments for insert
  to authenticated
  with check (
    school_id = public.my_school_id()
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.submissions s
      where s.id = report_id and s.submitted_by = auth.uid()
    )
  );

create policy "report_attachments_delete_staff"
  on public.report_attachments for delete
  to authenticated
  using (
    school_id = public.my_school_id()
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );

-- ============================================================
-- 4. Dashboard aggregates follow the new access model
-- ============================================================
create or replace function public.dashboard_counts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := public.my_school_id();
  v_role public.app_role;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_school is null then
    raise exception 'no school is assigned to this account';
  end if;

  select p.role into v_role from public.profiles p where p.id = auth.uid();

  v_out := v_out || jsonb_build_object(
    'role', coalesce(v_role::text, 'unknown'),
    'my_check_ins_today', (
      select count(*) from public.check_ins c
      where c.school_id = v_school and c.profile_id = auth.uid()
        and c.checked_in_at >= current_date
    ),
    'my_need_help', (
      select count(*) from public.check_ins c
      where c.school_id = v_school and c.profile_id = auth.uid()
        and c.status = 'need_help'
    )
  );

  -- Students cannot read submissions, so they get no submission counts at all.
  if v_role in ('teacher_staff', 'responder', 'administrator') then
    v_out := v_out || jsonb_build_object(
      'submissions_open', (
        select count(*) from public.submissions s
        where s.school_id = v_school and s.status <> 'resolved'
      ),
      'submissions_sentiment_open', (
        select count(*) from public.submissions s
        where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'sentiment'
      ),
      'submissions_hazard_open', (
        select count(*) from public.submissions s
        where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'incident_hazard'
      ),
      'submissions_observation_open', (
        select count(*) from public.submissions s
        where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'observation'
      ),
      'school_open_incidents', (
        select count(*) from public.incidents i
        where i.school_id = v_school
          and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')
      ),
      'school_unacknowledged_incidents', (
        select count(*) from public.incidents i
        where i.school_id = v_school and i.status = 'new'
      ),
      'school_oldest_unacknowledged_minutes', (
        select coalesce(floor(extract(epoch from (now() - min(i.created_at))) / 60)::bigint, 0)
        from public.incidents i
        where i.school_id = v_school and i.status = 'new'
      ),
      'school_open_reports', (
        select count(*) from public.submissions s
        where s.school_id = v_school and s.status <> 'resolved'
      ),
      'school_check_ins_today', (
        select count(*) from public.check_ins c
        where c.school_id = v_school and c.checked_in_at >= current_date
      ),
      'school_need_help', (
        select count(*) from public.check_ins c
        where c.school_id = v_school and c.status = 'need_help'
      )
    );
  end if;

  if v_role = 'administrator' then
    v_out := v_out || jsonb_build_object(
      'users_total', (
        select count(*) from public.profiles p where p.school_id = v_school
      ),
      'users_by_role', (
        select coalesce(jsonb_object_agg(r.role::text, r.n), '{}'::jsonb)
        from (
          select p.role, count(*) as n
          from public.profiles p
          where p.school_id = v_school
          group by p.role
        ) r
      ),
      'audit_rows_30d', (
        select count(*) from public.audit_logs a
        where a.created_at > now() - interval '30 days'
      )
    );
  end if;

  return v_out;
end;
$$;

comment on function public.dashboard_counts() is 'Role-filtered dashboard aggregates. Numbers only. Students get their own check-in counts only - they cannot read submissions.';
