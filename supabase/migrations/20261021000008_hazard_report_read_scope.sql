-- Migration: 20261021000008_hazard_report_read_scope.sql
-- Narrows hazard-report read scope to the approved permission matrix
-- (docs/ARCHITECTURE.md section 1.1 and 1.2): a report is visible to its
-- reporter and to responder/administrator reviewers of the same school.
-- School scoping is evaluated first, so a report can never be read across schools.
-- Migration 0007 is already applied; this is a forward-only change.

drop policy if exists hazard_reports_select_school on public.hazard_reports;

create policy "hazard_reports_select_school"
  on public.hazard_reports for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and (reporter_id = auth.uid() or public.is_reviewer())
  );

comment on policy "hazard_reports_select_school" on public.hazard_reports is 'Own-school reports readable by the reporter and by responder/administrator reviewers only.';
