-- Migration: 20261021000025_attachment_insert_ownership.sql
-- The attachment insert policy looked up the submission with a subquery, which is
-- filtered by the submissions read policy (students may send but not read), so
-- the sender could not register their own attachment row. The ownership check now
-- runs through the security-definer helper.

drop policy if exists report_attachments_insert_owner on public.report_attachments;

create policy "report_attachments_insert_owner"
  on public.report_attachments for insert
  to authenticated
  with check (
    school_id = public.my_school_id()
    and uploaded_by = auth.uid()
    and public.submission_owner(report_id)
  );
