-- Migration: 20261021000026_photo_read_for_staff.sql
-- Staff could not read (and therefore could not delete) a photo whose submission
-- had already been removed: the read policy required a matching submissions row,
-- so the object was invisible and the Storage API could not resolve it. Staff now
-- read the photos of their own school directly, which also makes orphaned objects
-- removable.
--
-- Students keep no read access at all: they may send, and staff review.

drop policy if exists report_photos_select_staff on storage.objects;

create policy "report_photos_select_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = public.my_school_id()::text
    and public.my_role() in ('teacher_staff', 'responder', 'administrator')
  );

comment on policy "report_photos_select_staff" on storage.objects is 'Staff read the photos of their own school. Students cannot read report media - they may only send.';
