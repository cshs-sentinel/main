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
