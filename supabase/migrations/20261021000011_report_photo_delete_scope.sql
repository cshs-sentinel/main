-- Migration: 20261021000011_report_photo_delete_scope.sql
-- Fixes an operability gap found in migration 0009: the storage delete policy
-- required the hazard report row to still exist, so a photo whose report was
-- already removed became undeletable by anyone (Supabase also blocks direct SQL
-- deletes on storage.objects). Read and delete are now scoped by the school
-- folder in the object path plus uploader ownership / reviewer rights, so:
--   - reporters still see and delete only their own report photos,
--   - reviewers can see and moderate any photo in their own school,
--   - orphaned photos can be cleaned up instead of living forever.
-- Cross-school access remains impossible: the path folder must be the user's school.

drop policy if exists "report_photos_select_authorized" on storage.objects;
drop policy if exists "report_photos_delete_own" on storage.objects;

create policy "report_photos_select_authorized"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = public.my_school_id()::text
    and (
      owner_id = auth.uid()::text
      or public.is_reviewer()
      or exists (
        select 1 from public.hazard_reports r
        where r.id::text = (storage.foldername(name))[2]
          and r.reporter_id = auth.uid()
      )
    )
  );

create policy "report_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = public.my_school_id()::text
    and (owner_id = auth.uid()::text or public.is_reviewer())
  );
