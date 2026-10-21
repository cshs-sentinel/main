# SENTINEL — Development Log

Per-task record: phase, task id, files, tests, gate status. Required by
`docs/ARCHITECTURE.md` "Shared Contracts" #10 and
`SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §"Maintain a small docs/DEVELOPMENT_LOG.md".

Project: MCSI-08 SENTINEL — mobile-first school safety and incident-coordination web app.
Repo: `cshs-sentinel/main` · Supabase project `vuqjfigoeuvjieznqyil` (dev).

---

## Phase 1 — Foundation, identity, RLS (Gate 1 ✅)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 1.1 | `03abbc2` | scaffold, env hygiene, Vitest harness | lint/typecheck/test/build | done |
| 1.2 | — | `supabase/migrations/20261021000001_identity_rls.sql` (profiles, audit_logs, `is_admin`, `admin_set_user_role` RPC) | verify-rls §1–§7 | done |
| 1.3 | `ebdd682` | `src/lib/supabase.ts` + env validation | unit tests | done |
| 1.4 | — | signup trigger, role self-assignment prevention | verify-rls §6 | done |
| 1.5 | `0833e95` | `scripts/verify-rls.mjs`, `docs/ROLLBACK.md` | verify-rls | done — **Gate 1 approved** |

## Phase 2 — School structure and schedules (Gate 2 ✅)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 2.1 | `1b14bda` | `src/features/auth/*` (login, signup, protected routes) | vitest | done |
| 2.2 | `6d2cca2` | `RoleGuard`, `AdminUsers` | vitest | done |
| 2.3 | `0a77f6b` | migration 0002 school structure (later replaced by 0003) | verify-rls | done |
| 2.4 | `94add76` | migrations 0003–0005 (schools, categories, unified locations, multi-school) | verify-rls §8–§9 | done |
| 2.5 | `60a65e1` | `src/features/admin/Locations.tsx`, `/admin/structure` | 13 unit tests | done |
| 2.6 | `c1045a0` | migration 0006 `schedules`, `AdminSchedules.tsx`, `Schedule.tsx` | 14 unit tests | done |
| 2.7 | `726f8cc` | `docs/GATE2_EVIDENCE.md`, boundary checks | verify-rls 78/78 | done — **Gate 2 approved** |

Gate 2 evidence: authorized users see only permitted school data; schedule data are
never presented as verified occupancy (`/schedule` notice + `schedule-derived` tags).

## Phase 3 — Check-ins and hazard reports (complete, Gate 3 approved)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 3.1 | `88e5a07` | Migrations 0007 (`hazard_reports` + review workflow) & 0008 (read scope narrowed), verify-rls §11, docs de-conflict | verify-rls, 48 unit tests | done |
| 3.2 | *pending* | Migrations 0009 (private `report-photos` bucket, `report_attachments`, storage policies), 0010 (filename fix), 0011 (photo read/delete scope), verify-rls §12 | verify-rls 125/125 | done |
| 3.3 | *pending* | `src/features/reports/Reports.tsx` + `shared.ts` + tests, `/reports` route, CSS | 6 unit tests | done |
| 3.4 | *pending* | `src/features/admin/AdminReports.tsx` + tests, `/admin/reports` route (responder/admin) | 5 unit tests | done |
| 3.6 | *pending* | Migration 0012 `check_ins`, `src/features/checkin/CheckIn.tsx` + tests, `/check-in` route, verify-rls §13 | 6 unit tests | done |
| 3.5 | *pending* | `docs/GATE3_EVIDENCE.md`, ARCHITECTURE/ROLLBACK/DEVELOPMENT_LOG/README updates | verify-rls 135/135, 65 unit tests | done — **Gate 3 approved** |

## Phase 4 — SOS and incident response (complete, Gate 4 pending review)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 4.1 | *pending* | Migration 0013 (`incidents`, `incident_status_history`, `incident_notes`, `next_case_ref()`, `transition_incident()`), verify-rls §14 | verify-rls 162/162 | done |
| 4.2 | *pending* | `src/features/incidents/Sos.tsx` + `shared.ts` + tests, `/sos` route | 7 unit tests | done |
| 4.3 | *pending* | `src/features/admin/AdminIncidents.tsx` + tests, `/incidents` route (responder/admin) | 6 unit tests | done |
| 4.4 | *pending* | `docs/MANUAL_FALLBACK.md` (fallback procedure + response responsibilities) | — | done |
| 4.5 | *pending* | `docs/GATE4_EVIDENCE.md`, ARCHITECTURE/ROLLBACK/DEVELOPMENT_LOG updates | verify-rls 162/162, 78 unit tests | done — **awaiting Gate 4 review** |

Incident model (migration 0013): server-allocated `SNT-YYYY-####` case references;
status changes only through the role-checked `transition_incident()` function,
which writes the status history and an `incident_transition` audit row; clients
have no update or delete rights on incidents, history or notes; a 5-minute
duplicate guard per person; cancellation by the creator or an administrator with
the history preserved.

## Phase 5 — Dashboard and reporting (complete, Gate 5 pending review)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 5.1 | *pending* | Migration 0014 (`dashboard_counts()` — role-filtered aggregates, counts only) | verify-rls §15 | done |
| 5.2 | *pending* | `src/features/dashboard/Dashboard.tsx` + tests, `/dashboard` route, `.dash-*` CSS | 7 unit tests | done |
| 5.3 | *pending* | verify-rls §15 (8 dashboard checks), `docs/GATE5_EVIDENCE.md`, ARCHITECTURE/ROLLBACK updates | verify-rls 170/170, 85 unit tests | done — **awaiting Gate 5 review** |

Dashboard model (migration 0014): `dashboard_counts()` returns numbers only —
students get their own counts and no school-level keys, teachers add school
counts, administrators add user and audit counts. The UI gates the school section
on the client-side role, so a mis-scoped response still cannot show a student
school-wide numbers. Published alerts and the weather advisory are shown as "not
available yet" rather than faked.

## Phase 6 — Weather and computation (complete, Gate 6 pending review)

| Task | Commit | Files | Tests | Status |
|---|---|---|---|---|
| 6.1 | *pending* | `src/features/weather/heatIndex.ts` (pure module), `docs/HEAT_INDEX.md`, migration 0015 `weather_observations` | 42 heat-index tests | done |
| 6.2 | *pending* | `worker/index.ts` + `worker/wrangler.toml` (Cloudflare Worker, service-role secret), deployed as `sentinel-weather` | live worker response + storage check | done |
| 6.3 | *pending* | `src/features/weather/WeatherAdvisory.tsx` + tests, dashboard wiring, verify-rls §16 | 5 UI tests, 6 API checks | done |
| 6.4 | *pending* | `docs/GATE6_EVIDENCE.md`, ARCHITECTURE/ROLLBACK updates | verify-rls 175/175, 132 unit tests | done — **awaiting Gate 6 review** |
| 6.5 | *pending* | `worker/index.ts` (staleness from `observed_at`), `src/features/weather/WeatherAdvisory.tsx` (same), `worker/worker.test.ts` (new) | 5 worker tests, 7 UI tests | done |

Weather model (Phase 6): the NOAA/NWS Rothfusz regression lives in a pure module
tested against the NOAA reference table; the Cloudflare Worker fetches the
observation, calls the same module, stamps source/timestamps/units/freshness/rule
version, stores the observation server-side and serves the advisory. The advisory
is advisory-only, visible to responders and administrators, and never triggers an
automatic action. The school coordinates are still placeholders and are labelled
as such until the real location is configured.

Staleness correction (Task 6.5): the worker and the UI computed staleness from the
*fetch* timestamp, which is always current, so `freshness.stale` and the stored
`is_stale` column could never become true and the live "STALE" marker could never
appear — contradicting `docs/HEAT_INDEX.md` §6 and `docs/ARCHITECTURE.md` §7. Both
now measure the age of the **observation** (`observed_at`), which is what the
freshness window is defined against. `worker/worker.test.ts` covers it: an
observation two hours old is reported stale and stored with `is_stale: true`, while
a current one is not.

Implemented report model (migrations 0007–0008): any authenticated member files a
report for their own school as themselves; a report is readable by its reporter and
by responder/administrator reviewers only; reviewers move status through
`open → acknowledged → resolved` (one-step undo); details are immutable after
submission; no client delete; creations and status changes are audited.

Implemented media model (migrations 0009–0011): private `report-photos` bucket
(5 MB, JPEG/PNG/WebP), objects at `{school_id}/{report_id}/{filename}`, access
only through 60-second signed URLs, storage policies mirroring the report read
scope, and a `report_attachments` table whose rows must match the report path.

Implemented check-in model (migration 0012): a check-in is a self-report with an
explicit `location_source` (`self_selected`, `schedule_derived`,
`staff_verified`); `schedule_derived` requires an active schedule for today,
`staff_verified` is staff-only, and the record is immutable.

### Known environment issue (2026-10-21)
Intermittent network failures from the build machine to `*.supabase.co` (connect
timeouts, ~2 h) caused several verification runs to fail mid-way. Every failure was
traced to connectivity, not logic; a clean run was obtained for each task. The RLS
harness now asserts on resulting database state rather than RPC transport for the
role-promotion checks, so a dropped response cannot produce a false failure.

### Conflicts resolved (2026-10-21)
- Spec vs implementation: `ARCHITECTURE.md` §1.1/§1.2 forbade students and staff
  from reading other members' reports, while migration 0007 granted all same-school
  roles read access. Resolved toward the specification with migration 0008
  (reporter + responder/admin only), and §1.1/§1.2 now state the implemented scope.
- Route shapes: `/reports/new` + `/reports/:id` replaced by the approved
  `/reports` + `/admin/reports` (documented in §2.1).
- Missing referenced docs: `docs/FIRST_ADMIN.md` and `docs/DEVELOPMENT_LOG.md`
  created; `README.md` refreshed to describe the real project.
- Stale statements corrected: §2.2 (App.tsx no longer a Vite template), §4.1/§4.2/§4.3
  (planned vs implemented markers), §8.1 (hazard-report auditing), §10.2 (report
  validation), "Confirmed vs Proposed" summary, "Awaiting Approval" section.
