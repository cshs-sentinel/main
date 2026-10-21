# Gate 5 Evidence — Dashboard and reporting

Phase 5 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 5 = "Dashboard data match authorized source records and pass role-based tests."**

Status: **PASS** — external verification **170/170** (sections 1–15, including a new
dashboard section), local checks green (lint 0/0, typecheck ✓, 85 unit tests, build ✓).
Synthetic test data only.

---

## 1. Dashboard data match authorized source records

The dashboard reads the same tables as the rest of the app, under the same RLS, and
adds one aggregate function that returns **numbers only**.

| Concern | Evidence (verify-rls §15) |
|---|---|
| Aggregates equal the readable rows | *dashboard incident count matches the readable rows* (`head` count vs selected rows, as administrator) |
| …and for a student too | *student dashboard scope matches the rows a student can read* |
| Unauthenticated callers rejected | *anon blocked from dashboard counts* — `authentication required` |
| No privileged key in the browser | the function is a `security definer` server function, granted only to `authenticated`; `revoke … from public` |

## 2. Role-based tests (API layer and UI)

| Role | What the dashboard returns | Evidence |
|---|---|---|
| student | own-record counts only: `my_check_ins_today`, `my_open_incidents`, `my_open_reports`, `my_need_help` | §15 *student receives own-record counts*; *student receives no school-wide counts* (asserted by the absence of the `school_*` keys) |
| teacher_staff | own counts **+** school counts, no user or audit numbers | §15 *teacher receives school counts (no identities)* (role promoted temporarily, then reverted) |
| responder | teacher scope + unacknowledged count and age of the oldest unacknowledged case | §15 + `Dashboard.test.tsx` *shows the response links to a responder* |
| administrator | everything + `users_total`, `users_by_role`, `audit_rows_30d` | §15 *administrator receives user and audit counts* |

UI-level tests (`src/features/dashboard/Dashboard.test.tsx`, 7 tests) assert the same
boundaries, including a defensive case: **if a server response ever contained
school-wide numbers for a student, the UI still refuses to render them** (the school
section is gated on the client-side role, not on the response).

## 3. Privacy rules from the specification

`docs/ARCHITECTURE.md` §7.1 requires: *"Aggregates must not expose individual student
locations to unauthorized roles … teacher dashboards show counts, not individual
names unless policy explicitly allows - default: counts only."*

- `dashboard_counts()` returns **numbers only** — no names, no locations, no free text.
- Student responses contain **no** school-level keys at all (asserted server-side).
- Teacher responses contain **no** user or audit counts.
- The individual records a responder may open (`/incidents`, `/admin/reports`) stay behind
  their own RLS policies; the dashboard never widens access.

## 4. Phase 5 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| Smallest role-appropriate dashboard slice | `/dashboard` only; no charts, no extra modules |
| Reuse existing components and query patterns | same `fetchResults`/`applyResults` effect pattern, `.loc-*`/`.rep-*` components, same Supabase client; the only new server surface is one aggregate function |
| Avoid exposing names/locations/notes/reports to roles that do not need them | §15 role scoping + UI gating; counts only |
| Test permissions at the database/API layer as well as the UI | §15 (8 checks) + `Dashboard.test.tsx` (7 tests) |
| Do not add unrelated charts or features | none added; alerts and weather are explicitly shown as "Not available yet" rather than faked |

## 5. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 85/85 (16 files) |
| `npm run build` | exit 0 |
| `node scripts/verify-rls.mjs` (token) | **170/170 passed**, sections 1–15 |

Migration `20261021000014_dashboard_counts.sql` applied to the dev project; inverse SQL
in `docs/ROLLBACK.md`.

## 6. Known limitations

- No published alerts and no weather advisory yet (Phases 7 and 6); the dashboard states this explicitly instead of showing a placeholder value.
- The "oldest unacknowledged case" metric counts from case creation, not from the school's agreed response time (that threshold is a local policy).
- Check-in counts are calendar-day counts in the database timezone (UTC), which can differ from a school's local day boundary.
- Teacher-level "building" counts are school-wide for v1: a per-building model (buildings have no separate scope yet) is not implemented.
- Counts are computed live per page load; no caching or pre-aggregation (fine at school scale, but not designed for large deployments).
- No e2e/browser tests; UI behaviour is covered by vitest + jsdom, permissions by the API harness.
