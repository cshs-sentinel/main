# First Administrator Provisioning

How the first `administrator` account is created safely, and how further admins are
managed. Roles are **never** self-assignable (RLS: no client insert/update policy on
`public.profiles`; role changes go only through the audited RPC below).

## 1. First administrator (one-time, manual)

1. The deployer signs up through the app (`/signup`) with a designated school email.
   The signup trigger creates `public.profiles` with `role = 'student'`.
2. In the Supabase dashboard → **SQL Editor**, run the statements below for that
   user id (found in Auth → Users):

   ```sql
   -- Inspect before changing
   select id, role, school_id from public.profiles where id = '<USER_UUID>';

   -- Promote to administrator (audited)
   update public.profiles
     set role = 'administrator', updated_at = now()
    where id = '<USER_UUID>';

   -- Verify
   select id, role, school_id from public.profiles where id = '<USER_UUID>';
   ```

3. The change is recorded in `public.audit_logs` (`action = 'role_changed'`) by the
   `set_updated_at` / audit triggers used on `profiles` writes, and can be reviewed
   by an administrator in the audit view.
4. Re-issue the session (sign out and back in) so the app picks up the new role.

Notes:
- The account must belong to the pilot school's `school_id`; every RLS policy is
  scoped by `my_school_id()`, so an admin only ever administers their own school.
- Prefer a personal, named account — not a shared login.

## 2. Subsequent administrators

In-app, from `/admin/users` (administrator only). The app calls the audited RPC:

```sql
select public.admin_set_user_role(target_user_id => '<USER_UUID>', new_role => 'administrator');
```

The RPC refuses non-admin callers (`permission denied: admin required`) and writes
an `audit_logs` row for every change.

## 3. Test accounts

`rls-admin@test.local` and `rls-student@test.local` are **synthetic** accounts used
only by `scripts/verify-rls.mjs` against the development project. They are not
production credentials and must never be used in a real school deployment.

## 4. Rollback of a mistaken promotion

```sql
update public.profiles
   set role = 'student', updated_at = now()
 where id = '<USER_UUID>';
```

Also revert through the app's user management screen so the change is audited.
