-- Migration: 20261021000010_fix_attachment_filename.sql
-- Fixes the attachment filename check introduced in migration 0009: the previous
-- rule rejected any name containing a dot, which blocked legitimate file
-- extensions (e.g. photo.png). The rule now blocks path traversal only.

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
  -- Block path traversal and control characters; allow normal file extensions.
  if v_parts[3] = '' or v_parts[3] = '.' or v_parts[3] = '..'
     or v_parts[3] like '%..%' or v_parts[3] ~ '[[:cntrl:]]' then
    raise exception 'invalid file name';
  end if;
  if char_length(v_parts[3]) > 120 then
    raise exception 'file name too long';
  end if;

  return new;
end;
$$;

comment on function public.validate_report_attachment() is 'Server-side attachment validation: reporter-only upload, path must match {school_id}/{report_id}/{filename}, traversal blocked.';
