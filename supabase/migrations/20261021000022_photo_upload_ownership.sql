-- Migration: 20261021000022_photo_upload_ownership.sql
-- The storage insert policy looked up the submission with a subquery, but that
-- lookup was subject to the submissions read policy - and students may send but
-- not read submissions, so the uploader could not attach a photo to their own
-- submission. Ownership is now checked with a security-definer helper, which is
-- not affected by the read policy.

create or replace function public.submission_owner(p_submission_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and s.submitted_by = auth.uid()
  );
$$;

comment on function public.submission_owner(uuid) is 'True when the current user sent the given submission. Used by the storage policies, which cannot rely on the submissions read policy.';

revoke execute on function public.submission_owner(uuid) from public;
grant execute on function public.submission_owner(uuid) to authenticated;

drop policy if exists report_photos_insert_own on storage.objects;

create policy "report_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.school_id::text = (storage.foldername(name))[1]
    )
    and public.submission_owner(((storage.foldername(name))[2])::uuid)
  );
