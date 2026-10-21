-- Migration: 20261021000021_photo_delete_without_row.sql
-- Orphaned photos (the submission was deleted, the object was not) could not be
-- removed: the storage delete policy required a matching submissions row.
-- Deletion is now scoped by the school folder in the path plus uploader/reviewer
-- rights, so orphaned objects can be cleaned up.

drop policy if exists report_photos_delete_staff on storage.objects;

create policy "report_photos_delete_staff"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = public.my_school_id()::text
    and (owner_id = auth.uid()::text or public.my_role() in ('teacher_staff', 'responder', 'administrator'))
  );

comment on policy "report_photos_delete_staff" on storage.objects is 'Delete a photo in the caller''s school: the uploader, or staff. Works even if the submission was already removed.';
