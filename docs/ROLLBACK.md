# SENTINEL — Rollback & Recovery

## Migration Rollback

Migrations are forward-only in the MVP (per `docs/ARCHITECTURE.md`). To undo a migration:

### Option A: SQL Editor (Recommended)

1. Open Supabase Dashboard → SQL Editor.
2. Run the inverse of the migration. For `20261021000001_identity_rls.sql`:

```sql
-- Rollback identity migration (run only if explicitly approved)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.admin_set_user_role(uuid, public.app_role);
drop function if exists public.is_admin();
drop table if exists public.audit_logs;
drop table if exists public.profiles;
drop type if exists public.app_role;
```

3. Verify objects dropped via `supabase migration list` or dashboard Schema Viewer.

For `20261021000002_school_structure.sql`:

```sql
-- Rollback school-structure migration (run only if explicitly approved)
drop trigger if exists buildings_audit on public.buildings;
drop trigger if exists floors_audit on public.floors;
drop trigger if exists rooms_audit on public.rooms;
drop trigger if exists buildings_set_updated_at on public.buildings;
drop trigger if exists floors_set_updated_at on public.floors;
drop trigger if exists rooms_set_updated_at on public.rooms;
drop function if exists public.audit_school_structure();
drop function if exists public.set_updated_at();
drop table if exists public.rooms;
drop table if exists public.floors;
alter table public.profiles drop column if exists building_id;
drop table if exists public.buildings;
-- Note: dropping buildings also removes profiles.building_id references first
```

For `20261021000003_locations_schools.sql` + `...0004` + `...0005` (Phase 2 locations):

```sql
-- Rollback Phase 2 locations/multi-school (run only if explicitly approved)
-- WARNING: loses locations, categories, school scoping, and profiles.school_id.
drop trigger if exists locations_audit on public.locations;
drop trigger if exists categories_audit on public.location_categories;
drop trigger if exists schools_audit on public.schools;
drop trigger if exists locations_validate on public.locations;
drop trigger if exists locations_no_school_reassign on public.locations;
drop trigger if exists categories_no_school_reassign on public.location_categories;
drop trigger if exists locations_set_updated_at on public.locations;
drop trigger if exists categories_set_updated_at on public.location_categories;
drop trigger if exists schools_set_updated_at on public.schools;
drop function if exists public.validate_location();
drop function if exists public.prevent_school_reassign();
drop function if exists public.audit_school_structure();
drop function if exists public.set_updated_at();
drop function if exists public.my_school_id();
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists audit_logs_select_admin on public.audit_logs;
alter table public.profiles drop column if exists primary_location_id;
alter table public.profiles drop column if exists school_id;
drop table if exists public.locations;
drop table if exists public.location_categories;
drop table if exists public.schools;

-- Then re-apply 0002 to restore buildings/floors/rooms if needed:
-- (re-run supabase migration 20261021000002_school_structure.sql)
```

For `20261021000006_schedules.sql` (Phase 2 schedules):

```sql
-- Rollback schedules migration (run only if explicitly approved)
-- WARNING: loses all schedule rows; locations and profiles are untouched.
drop trigger if exists schedules_audit on public.schedules;
drop trigger if exists schedules_no_school_reassign on public.schedules;
drop trigger if exists schedules_set_updated_at on public.schedules;
drop trigger if exists schedules_validate on public.schedules;
drop function if exists public.validate_schedule();
drop policy if exists schedules_select_school on public.schedules;
drop policy if exists schedules_insert_admin on public.schedules;
drop policy if exists schedules_update_admin on public.schedules;
drop table if exists public.schedules;
```

For `20261021000007_hazard_reports.sql` (Phase 3 hazard reports):

```sql
-- Rollback hazard reports migration (run only if explicitly approved)
-- WARNING: loses all hazard report rows and their audit trail entries.
-- Shared helpers (set_updated_at, prevent_school_reassign, audit_school_structure)
-- are NOT dropped — they are used by other tables.
drop trigger if exists hazard_reports_audit on public.hazard_reports;
drop trigger if exists hazard_reports_no_school_reassign on public.hazard_reports;
drop trigger if exists hazard_reports_set_updated_at on public.hazard_reports;
drop trigger if exists hazard_reports_validate on public.hazard_reports;
drop function if exists public.validate_hazard_report();
drop function if exists public.is_reviewer();
drop policy if exists hazard_reports_select_school on public.hazard_reports;
drop policy if exists hazard_reports_insert_own on public.hazard_reports;
drop policy if exists hazard_reports_update_reviewers on public.hazard_reports;
drop table if exists public.hazard_reports;

-- Optional: remove audit rows for the dropped reports (audit_logs is append-only)
-- delete from public.audit_logs where entity_type = 'hazard_reports';
```

For `20261021000008_hazard_report_read_scope.sql` (read-scope narrowing) — run
**before** the 0007 rollback above, and only if the `hazard_reports` table still
exists:

```sql
-- Restores the broader 0007 read scope (all same-school roles read all reports).
-- Prefer leaving 0008 in place: the narrower scope matches the approved
-- permission matrix in docs/ARCHITECTURE.md section 1.1/1.2.
drop policy if exists hazard_reports_select_school on public.hazard_reports;

create policy "hazard_reports_select_school"
  on public.hazard_reports for select
  to authenticated
  using (school_id = public.my_school_id());
```

For `20261021000009_report_photos.sql` … `20261021000012_check_ins.sql`
(Phase 3 storage, attachments and check-ins) — roll back in reverse order:

```sql
-- 0012 check-ins
drop trigger if exists check_ins_validate on public.check_ins;
drop function if exists public.validate_check_in();
drop policy if exists check_ins_select_own_or_reviewer on public.check_ins;
drop policy if exists check_ins_insert_own on public.check_ins;
drop table if exists public.check_ins;

-- 0011 photo read/delete scope (restores the 0009 policies)
drop policy if exists report_photos_select_authorized on storage.objects;
drop policy if exists report_photos_delete_own on storage.objects;
create policy "report_photos_select_authorized"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.hazard_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.school_id::text = (storage.foldername(name))[1]
    )
  );
create policy "report_photos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-photos'
    and exists (
      select 1 from public.hazard_reports r
      where r.id::text = (storage.foldername(name))[2]
        and (r.reporter_id = auth.uid() or public.is_reviewer())
    )
  );

-- 0010 filename fix (superseded by dropping the function in 0009 rollback)
drop function if exists public.validate_report_attachment();

-- 0009 attachments, policies and bucket
-- NOTE: storage objects cannot be deleted with SQL. Empty the bucket through the
-- Storage API first (a reviewer account can remove every object), otherwise the
-- bucket can only be dropped together with its objects.
drop trigger if exists report_attachments_validate on public.report_attachments;
drop function if exists public.validate_report_attachment();
drop policy if exists report_attachments_select_report_scope on public.report_attachments;
drop policy if exists report_attachments_insert_reporter on public.report_attachments;
drop policy if exists report_attachments_delete_own on public.report_attachments;
drop table if exists public.report_attachments;
drop policy if exists report_photos_insert_own on storage.objects;
-- delete the bucket only after its objects are removed via the Storage API:
-- delete from storage.buckets where id = 'report-photos';
```

For `20261021000013_incidents.sql` (Phase 4 SOS / incidents):

```sql
-- Rollback incidents migration (run only if explicitly approved)
-- WARNING: loses all incident cases, their history and their notes.
drop trigger if exists incidents_audit on public.incidents;
drop trigger if exists incident_notes_audit on public.incident_notes;
drop trigger if exists incidents_set_updated_at on public.incidents;
drop trigger if exists incidents_validate on public.incidents;
drop function if exists public.validate_incident();
drop function if exists public.next_case_ref();
drop function if exists public.transition_incident(uuid, text, text);
drop policy if exists incident_notes_select_readable on public.incident_notes;
drop policy if exists incident_notes_insert_author on public.incident_notes;
drop policy if exists incident_history_select_readable on public.incident_status_history;
drop policy if exists incidents_select_creator_or_reviewer on public.incidents;
drop policy if exists incidents_insert_own on public.incidents;
drop table if exists public.incident_notes;
drop table if exists public.incident_status_history;
drop table if exists public.incidents;
drop table if exists public.incident_case_refs;
```

For `20261021000014_dashboard_counts.sql` (Phase 5 dashboard aggregates):

```sql
-- Removes the dashboard aggregate function. The dashboard UI then shows an
-- explicit error until the function is re-applied.
revoke execute on function public.dashboard_counts() from authenticated;
drop function if exists public.dashboard_counts();
```

For `20261021000015_weather_observations.sql` (Phase 6 weather observations):

```sql
-- Removes the stored weather observations and the table. The worker keeps
-- working and will simply fail to store new rows (it logs and continues).
drop policy if exists weather_observations_select_school on public.weather_observations;
drop table if exists public.weather_observations;
```

The Cloudflare Worker is undeployed separately:
`npx wrangler delete --config worker/wrangler.toml` (also removes its secrets).

For `20261021000016_alerts.sql` and `20261021000017_alert_workflow_flag.sql`
(Phase 7 alerts and case notifications):

```sql
-- Removes the alert workflow, the alerts and the case notifications.
-- WARNING: loses all alert drafts, publications, corrections and cancellations.
drop trigger if exists incidents_notify on public.incidents;
drop function if exists public.notify_new_incident();
drop trigger if exists alerts_set_updated_at on public.alerts;
drop trigger if exists alerts_validate on public.alerts;
drop function if exists public.validate_alert();
drop function if exists public.approve_alert(uuid);
drop function if exists public.publish_alert(uuid);
drop function if exists public.correct_alert(uuid, text, text, text);
drop function if exists public.cancel_alert(uuid, text);
drop function if exists public.my_role();
drop policy if exists alerts_select_audience on public.alerts;
drop policy if exists alerts_insert_staff on public.alerts;
drop policy if exists alerts_update_own_draft on public.alerts;
drop policy if exists incident_notifications_select_reviewers on public.incident_notifications;
drop table if exists public.incident_notifications;
drop table if exists public.alerts;
```

### Option B: Point-in-time Restore

If the project plan supports PITR:
1. Dashboard → Database → Backups.
2. Restore to a timestamp before the migration.
3. Note: free tier may not include PITR; confirm current Supabase free-tier capabilities.

## App Rollback

If bad frontend code is deployed:
1. Cloudflare Pages → Deployments → select previous successful deployment → Rollback.
2. Or `git revert <commit>` and push.

## Data Recovery

| Data | Recovery |
|---|---|
| `profiles` | Recreated by signup trigger for existing auth users; otherwise re-run trigger or insert manually |
| `audit_logs` | Append-only; no recovery needed if empty; restore from backup if populated |
| Auth users | Supabase Auth manages; cannot restore deleted users without backup |

## Contacts

- Project: `vuqjfigoeuvjieznqyil` (cshs-sentinel)
- Dashboard: https://supabase.com/dashboard/project/vuqjfigoeuvjieznqyil
