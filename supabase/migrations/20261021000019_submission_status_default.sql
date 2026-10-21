-- Migration: 20261021000019_submission_status_default.sql
-- Fixes the default left over from the pre-realignment table: new submissions
-- must start as "new" (the validation trigger rejects anything else, so the
-- default had to change with the taxonomy).

alter table public.submissions alter column status set default 'new';

comment on column public.submissions.status is 'new -> acknowledged -> resolved. New submissions always start as "new".';
