-- Migration: 20261021000024_attachment_function_rename.sql
-- Renaming a table does not rewrite the bodies of functions that mention it, so
-- validate_report_attachment() still referred to public.hazard_reports. It now
-- refers to public.submissions.

create or replace function public.validate_report_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_parts text[];
begin
  if auth.uid() is not null then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    if new.uploaded_by is distinct from auth.uid() then
      raise exception 'attachment must be uploaded by yourself';
    end if;
  end if;

  select * into v_submission from public.submissions where id = new.report_id;
  if not found then
    raise exception 'submission not found';
  end if;
  if v_submission.school_id <> new.school_id then
    raise exception 'submission belongs to a different school';
  end if;
  if auth.uid() is not null and v_submission.submitted_by is distinct from auth.uid() then
    raise exception 'only the sender can attach photos';
  end if;

  -- Path must be {school_id}/{submission_id}/{filename}
  v_parts := string_to_array(new.storage_path, '/');
  if array_length(v_parts, 1) <> 3 then
    raise exception 'storage path must be {school_id}/{submission_id}/{filename}';
  end if;
  if v_parts[1] <> new.school_id::text or v_parts[2] <> new.report_id::text then
    raise exception 'storage path does not match the submission';
  end if;
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

comment on function public.validate_report_attachment() is 'Server-side attachment validation: sender only, path must match {school_id}/{submission_id}/{filename}.';
