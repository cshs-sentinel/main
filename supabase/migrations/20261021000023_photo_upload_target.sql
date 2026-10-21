-- Migration: 20261021000023_photo_upload_target.sql
-- The storage insert policy still contained a subquery on public.submissions,
-- which is filtered by the submissions read policy (students may send but not
-- read). The check is now entirely inside a security-definer helper, so the
-- uploader can attach a photo to their own submission without being able to
-- read submissions back.

create or replace function public.submission_photo_target(
  p_submission_id text,
  p_school_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id::text = p_submission_id
      and s.school_id::text = p_school_id
      and s.submitted_by = auth.uid()
  );
$$;

comment on function public.submission_photo_target(text, text) is 'True when the current user sent that submission and it belongs to the school in the object path.';

revoke execute on function public.submission_photo_target(text, text) from public;
grant execute on function public.submission_photo_target(text, text) to authenticated;

drop policy if exists report_photos_insert_own on storage.objects;

create policy "report_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and public.submission_photo_target(
      (storage.foldername(name))[2],
      (storage.foldername(name))[1]
    )
  );
