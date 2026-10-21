# Gate 2 Evidence — School structure and schedules

Phase 2 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6 (Phase table):
**Gate 2 = "Authorized users see only permitted school data; schedule data are not presented as verified occupancy."**

Status: **PASS** — local checks all pass (lint/typecheck/48 tests/build) and external RLS
verification completed a full clean **78/78** (sections 1–10) including the two time-boundary
checks in §4 below. Synthetic test data only — no real student data.

---

## 1. Authorized users see only permitted school data

External verification: `node scripts/verify-rls.mjs` with `SUPABASE_ACCESS_TOKEN` set —
**78/78 checks passed** (sections 1–10), including the zero-length and single-day boundary checks.

| Concern | Evidence (verify-rls section → check) |
|---|---|
| Anon blocked | §1 profiles/audit; §8 locations/categories/schools; §10 schedules — 0 rows |
| Own-school read only | §4 student reads own profile, others' profiles 0 rows; §8 student reads exactly own school (1 row) and own-school categories; §9 admin/student cannot read school B locations, profiles limited to own school; §10 student reads own-school schedules |
| Cross-school writes denied | §9 admin A cross-school insert/update denied (RLS); §10 cross-school schedule insert denied |
| Role permissions | §4 student cannot insert locations (RLS deny); §10 student schedule insert denied, update/delete blocked (0 rows, no error); §6 non-admin RPC denied |
| Delete discipline | §8 locations: admin delete blocked — archive only, row intact; §10 schedules: admin delete blocked — deactivate only, row intact |
| Schedule validation is server-side | §10 overlap rejected, adjacent allowed, other-day allowed, inactive-doesn't-conflict, activating-conflict rejected, end-before-start rejected, zero-length rejected, effective-range order rejected, single-day inclusive boundary accepted, cross-school denied, archived-location rejected |
| Audit | §7 role changes; §8 location create/update; §10 schedule create/update audited |

RLS policy matrix (schema `20261021000006_schedules.sql` and predecessors):

| Table | select | insert | update | delete |
|---|---|---|---|---|
| schools | own school (all authed) | admin (RPC) | admin | none |
| locations | own school (all authed) | admin | admin | **none — archive only** |
| location_categories | own school (all authed) | admin | admin | none |
| schedules | own school (all authed) | admin | admin | **none — deactivate only** |
| profiles | own row / admin own school | — (sign-up RPC) | own or admin | none |
| audit_logs | own school (admin) | triggers only | — | — |

Additional layers: BEFORE-RLS triggers on locations (school scoping, archiving rules, cycles,
category/environment rules) and on `validate_schedule()` (time order, effective order, location
existence/school/archived checks, active-overlap conflict). Friendly error messages surface in UI.

## 2. Schedule data are not presented as verified occupancy

- `src/features/schedule/Schedule.tsx:61-63` — `role="note"` notice: expected locations "are not
  verified or observed locations".
- `src/features/schedule/Schedule.tsx:91` — per-row `schedule-derived` tag.
- Test `src/features/schedule/Schedule.test.tsx` — "labels rows as schedule-derived and warns they
  are not verified locations" asserts both the notice text and tags.
- `docs/ARCHITECTURE.md` §4.1/§4.2 — schedules documented as school-level timetable with no person
  FK; §4.3 lists `schedule-derived` status semantics.

## 3. Phase 2 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| Minimum building/floor/room data | `locations` hierarchy (campus→building→floor→room), verify-rls §8 creates and validates full chain |
| Schedule validity dates | `effective_from`/`effective_until`, inclusive boundary tested (§10 single-day accepted; order enforced) |
| Label schedule-derived as expected | §2 above |
| Tests: inactive/overlapping schedules | §10 overlap/adjacent/inactive/activate-conflict; `AdminSchedules.test.tsx` |
| Tests: time boundaries | §10 end-before-start, zero-length (start = end), effective-range order; `AdminSchedules.test.tsx` rejects equal start/end client-side |
| Tests: role permissions | §4/§6/§9/§10 matrix above; `RoleGuard.test.tsx`, `AdminSchedules.test.tsx`, `Schedule.test.tsx` |
| Synthetic records only | test users `*-test.local`; locations/schedules labeled `RLS %` and cleaned up per run |

## 4. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 48/48 (11 files) |
| `npm run build` | exit 0 (vite production build) |
| `node scripts/verify-rls.mjs` (token) | **78/78 passed**, sections 1–10 |

Migration: `supabase/migrations/20261021000006_schedules.sql` applied to dev project
(`vuqjfigoeuvjieznqyil`); inverse SQL recorded in `docs/ROLLBACK.md`.

## 5. Known limitations

- No schedule edit-times UI: create + activate/deactivate only; changed times require re-creation
  after deactivation.
- School-level timetable only — no per-person schedules (matches approved scope).
- No e2e/browser tests; UI behavior verified by vitest + jsdom unit tests only.
- Occupancy is never claimed anywhere in product copy — enforcement is presentational (text/tags),
  not a DB flag, since presence is inherently unverifiable by this system.
