-- Migration: 20261021000009_report_photos.sql
-- Private storage for hazard-report photos (Phase 3, Task 3.2).
-- Bucket is NOT public: objects are read through short-lived signed URLs that the
-- client requests only after the RLS read-scope check succeeds.
-- Path convention: {school_id}/{report_id}/{filename}
-- Media access mirrors the report read scope (migration 0008): the reporter and
-- responder/administrator reviewers of the same school only.

-- ============================================================
-- 1. Private bucket (created if missing)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Note: the bucket is private (public = false). Objects are read only through
-- short-lived signed URLs, and only after the report read-scope check passes.

-- ============================================================
-- 2. report_attachments (tracks which object belongs to which report)
-- ============================================================
create table public.report_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hazard_reports (id) on delete cascade,
  school_id uuid not null references public.schools (id),
  storage_path text not null,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint report_attachments_path_unique unique (storage_path)
);

comment on table public.report_attachments is 'Links a private storage object to a hazard report. Path must be {school_id}/{report_id}/{filename}.';

create index idx_report_attachments_report on public.report_attachments (report_id);

-- ============================================================
-- 3. Validation trigger: path must match the report, uploader must be the reporter
-- ============================================================
create or replace function public.validate_report_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.hazard_reports%rowtype;
  v_parts text[];
begin
  if auth.uid() is not null then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    if new.uploaded_by is distinct from auth.uid() then
      raise exception 'attachment must be uploaded by yourself';
    end if;
  end if;

  select * into v_report from public.hazard_reports where id = new.report_id;
  if not found then
    raise exception 'report not found';
  end if;
  if v_report.school_id <> new.school_id then
    raise exception 'report belongs to a different school';
  end if;
  if auth.uid() is not null and v_report.reporter_id is distinct from auth.uid() then
    raise exception 'only the reporter can attach photos';
  end if;

  -- Path must be {school_id}/{report_id}/{filename}
  v_parts := string_to_array(new.storage_path, '/');
  if array_length(v_parts, 1) <> 3 then
    raise exception 'storage path must be {school_id}/{report_id}/{filename}';
  end if;
  if v_parts[1] <> new.school_id::text or v_parts[2] <> new.report_id::text then
    raise exception 'storage path does not match the report';
  end if;
  if v_parts[3] = '' or v_parts[3] like '%.%' or v_parts[3] like '%..%' then
    raise exception 'invalid file name';
  end if;

  return new;
end;
$$;

comment on function public.validate_report_attachment() is 'Server-side attachment validation: reporter-only upload, path must match {school_id}/{report_id}/{filename}.';

create trigger report_attachments_validate
  before insert or update on public.report_attachments
  for each row execute function public.validate_report_attachment();

-- ============================================================
-- 4. RLS: reporter uploads; reads mirror the report read scope
-- ============================================================
alter table public.report_attachments enable row level security;

create policy "report_attachments_select_report_scope"
  on public.report_attachments for select
  to authenticated
  using (
    school_id = public.my_school_id()
    and exists (
      select 1 from public.hazard_reports r
      where r.id = report_id
        and (r.reporter_id = auth.uid() or public.is_reviewer())
    )
  );

create policy "report_attachments_insert_reporter"
  on public.report_attachments for insert
  to authenticated
  with check (
    school_id = public.my_school_id()
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.hazard_reports r
      where r.id = report_id and r.reporter_id = auth.uid()
    )
  );

create policy "report_attachments_delete_own"
  on public.report_attachments for delete
  to authenticated
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.hazard_reports r
      where r.id = report_id and r.reporter_id = auth.uid()
    )
  );
-- No client update.

-- ============================================================
-- 5. Storage policies (private bucket, scoped by school + report)
-- ============================================================
create policy "report_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.hazard_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.school_id::text = (storage.foldername(name))[1]
        and r.reporter_id = auth.uid()
    )
  );

create policy "report_photos_select_authorized"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.hazard_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.school_id::text = (storage.foldername(name))[1]
    )
  );

create policy "report_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.hazard_reports r
      where r.id::text = (storage.foldername(name))[2]
        and (r.reporter_id = auth.uid() or public.is_reviewer())
    )
  );
-- No client update on objects (re-upload = delete + insert).

grant select, insert, delete on storage.objects to authenticated;
grant select, insert, update, delete on public.report_attachments to authenticated;
