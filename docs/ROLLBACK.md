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
