# MCSI-08 SENTINEL — Architecture Specification

**Version:** 1.0 (Proposed)
**Status:** Awaiting approval — no code implements this yet unless noted.
**Basis:** Phase 0 audit + approved roadmap. Distinguishes **[CONFIRMED]** (exists now) from **[PROPOSED]** (to be built).

---

## 0. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Mobile-first)                   │
│  React 19 + TypeScript + Vite                                   │
│  Supabase JS Client (anon key + RLS)                            │
└───────────────┬─────────────────────────────────┬───────────────┘
                │ HTTPS                           │ HTTPS
                ▼                                 ▼
┌───────────────────────────┐       ┌─────────────────────────────┐
│   CLOUDFLARE PAGES        │       │   SUPABASE (Project:        │
│   Static hosting          │       │         "sentinel")         │
│   + Functions (server)    │       │   Auth, PostgREST, Storage  │
│   - /api/weather          │       │   Postgres + RLS            │
│   - /api/heat-index       │──────▶│   Service-role: server only │
└───────────────────────────┘       └─────────────────────────────┘
                │
                ▼
┌───────────────────────────┐
│  WEATHER PROVIDER (free)  │
│  (e.g., Open-Meteo)       │
│  Key: CF env secret only  │
└───────────────────────────┘
```

**[CONFIRMED]** Local scaffold: Vite 8 + React 19 + TS 6 + oxlint at repo root.
**[PROPOSED]** Everything else in this document.

---

## 1. User Roles and Permission Boundaries

### 1.1 Role Enum (`app_role`)

| Role | Purpose | Data Scope |
|---|---|---|
| `student` | School enrollee; check-in, SOS, view own schedule | Own records only |
| `teacher_staff` | Educator/staff; check-in, hazard reports, view building schedule | Own + building |
| `responder` | Safety officer; acknowledge/assign/resolve incidents; review reports | Assigned building(s) / all in scope |
| `administrator` | Full oversight; manage users, structure, alerts; approve publications | All within school |
| `system_operator` | Technical admin (optional, post-MVP) | Config only, no incident PII |

**Boundary rules (must be enforced in RLS + DB functions, not just UI):**
- No user can self-assign `responder` or `administrator`.
- Role changes occur only via `admin` RPC, with audit log.
- `service_role` key never leaves server; used only in Cloudflare Functions or Supabase Edge Functions.
- Students cannot read other students' check-ins, schedules, or reports.
  - *Implemented (Phase 2–3):* schedules are school-scoped plan data readable by all
    roles in the school (no person-level schedule rows exist, so no learner data is
    exposed); hazard reports are readable **only by the reporter and by
    responder/administrator reviewers** of the same school (migration 0008);
    check-ins do not exist yet.
- Responders see only incidents assigned to them or their building scope.

### 1.2 Permission Matrix (abbreviated)

| Action | student | teacher_staff | responder | administrator |
|---|---|---|---|---|
| Create check-in | ✓ (own) | ✓ (own) | ✓ (own) | ✓ (own) |
| Read own check-in | ✓ | ✓ | ✓ | ✓ |
| Read building check-ins | ✗ | ✓ | ✓ | ✓ |
| Create hazard report | ✓ | ✓ | ✓ | ✓ |
| Read own report | ✓ | ✓ | ✓ | ✓ |
| Read all reports | ✗ | ✗ | ✓ | ✓ |
| Upload report photo | ✓ (own) | ✓ (own) | ✓ | ✓ |
| Create SOS | ✓ | ✓ | ✓ | ✓ |
| Acknowledge/assign incident | ✗ | ✗ | ✓ | ✓ |
| Update incident status | ✗ | ✗ | ✓ | ✓ |
| Read building schedule | ✓ (own) | ✓ | ✓ | ✓ |
| Manage school structure | ✗ | ✗ | ✗ | ✓ |
| Manage users/roles | ✗ | ✗ | ✗ | ✓ |
| Draft alert | ✗ | ✗ | ✓ | ✓ |
| Approve/publish alert | ✗ | ✗ | ✓ (if approver) | ✓ |
| View audit log | ✗ | ✗ | ✗ | ✓ |

Full matrix to be encoded in RLS policies (Phase 1–2 migrations).

**Implementation status (2026-10-21):**

| Area | Status |
|---|---|
| Roles, profiles, audit log, admin RPC | Implemented (migrations 0001) |
| Schools, locations, categories, multi-school isolation | Implemented (0003–0005) |
| Schedules (own-school read for all roles) | Implemented (0006) |
| Hazard reports: file as self, reporter + reviewer read, reviewer status transitions, no client delete | Implemented (0007, read scope narrowed in 0008) |
| Report photo upload (private bucket) | Planned (Phase 3, next) |
| Check-ins | Planned |
| SOS / incidents, alerts, weather, dashboard | Planned (later phases) |

---

## 2. Frontend Pages and Navigation

**[PROPOSED]** React Router (or TanStack Router) with route guards.

### 2.1 Route Map

| Route | Page | Guard | Role(s) | Status |
|---|---|---|---|---|
| `/login` | Sign in | Public | — | Implemented |
| `/signup` | Sign up | Public | — | Implemented |
| `/` | Home + role links | Auth | All | Implemented |
| `/check-in` | Check-in button + history | Auth | student, teacher_staff, responder, admin | Planned |
| `/schedule` | Own schedule | Auth | All | Implemented |
| `/reports` | Hazard report form + own reports | Auth | All | Planned (Phase 3) |
| `/admin/reports` | Report review queue | Auth | responder, admin | Planned (Phase 3) |
| `/sos` | SOS trigger + case ref | Auth | All | Planned (Phase 4) |
| `/incidents` | Incident list (role-filtered) | Auth + role | responder, admin | Planned (Phase 4) |
| `/incidents/:ref` | Incident detail + timeline | Auth + role | responder, admin | Planned (Phase 4) |
| `/dashboard` | Role-specific dashboard | Auth + role | All (variant) | Planned (Phase 5) |
| `/admin/users` | User management | Auth | administrator | Implemented |
| `/admin/structure` | Locations CRUD | Auth | administrator | Implemented |
| `/admin/schedules` | Schedule management | Auth | administrator | Implemented |
| `/alerts` | Alert feed | Auth | All | Planned (Phase 7) |
| `/admin/alerts/new` | Alert composer | Auth | responder (approver), admin | Planned (Phase 7) |

> Route shapes for reports follow the approved Phase 3 plan: `/reports` combines the
> submission form with the reporter's own list, and `/admin/reports` is the
> responder/administrator review queue (the earlier `/reports/new` + `/reports/:id`
> split is superseded).

### 2.2 Navigation Shell

Mobile-first bottom nav (student view): **Home | Check-In | SOS | Alerts | More**
Staff/responder: adds **Reports | Incidents**
Admin: adds **Admin**

**[CONFIRMED]** The app is a Vite + React + TypeScript SPA with React Router route
guards (`src/App.tsx`); implemented routes are listed in §2.1.

---

## 3. Backend Services and API Boundaries

### 3.1 Communication Pattern

| Layer | Mechanism | Auth |
|---|---|---|
| Frontend ↔ Postgres | Supabase JS + PostgREST | Anon key + user JWT; RLS |
| Frontend ↔ Auth | Supabase Auth | Email/password |
| Frontend ↔ Storage | Supabase Storage | User JWT; bucket policies |
| Frontend ↔ Server logic | Cloudflare Pages Functions | User JWT passed; verify server-side |
| Server ↔ Weather API | Fetch in CF Function | API key in CF env |

**Rule:** Business logic that must be trusted (role checks for privileged actions, heat-index computation with secrets) runs server-side. Simple CRUD goes through PostgREST + RLS.

### 3.2 Cloudflare Functions (Proposed)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `weather` | GET | `/api/weather` | Fetch + normalize weather; cache in DB |
| `heat-index` | POST | `/api/heat-index` | Compute heat-index from inputs (or trigger from weather) |
| `incident-notify` | — | (internal) | Future: extend for external channels (post-MVP) |

No paid services. Weather provider: **Open-Meteo** (free, no API key required) or equivalent free tier — to be confirmed at Phase 7.

### 3.3 Supabase Edge Functions (Alternative)

If Cloudflare Functions add complexity, weather fetch can be a Supabase Edge Function (Deno) using service_role inside Supabase. Decision deferred to Phase 7; both are free-tier compatible.

---

## 4. Database Entities and Relationships

**[PROPOSED]** Core schema (migrations `0001`–`0011` per roadmap).

### 4.1 ER Overview

```
schools 1──* profiles
schools 1──* location_categories
schools 1──* locations (self-hierarchy)

profiles 1──1 auth.users
profiles *──* app_role (via profiles.role)
profiles *──0..1 locations (primary_location_id, optional)

locations 1──* locations (parent_id, optional; indoor + outdoor + custom)
locations *──1 location_categories

schedules *──1 schools
schedules *──1 locations (expected place; no person FK)

check_ins *──1 profiles
check_ins *──1 locations (optional)

hazard_reports *──1 profiles (reporter)
hazard_reports *──1 locations (optional)
hazard_reports *──1 schools
report_attachments *──1 hazard_reports  → storage bucket: report-photos (private)

incidents *──1 profiles (creator)
incidents *──1 profiles (acknowledged_by, assigned_to nullable)
incidents *──1 locations (optional, where recorded)
incident_status_history *──1 incidents
incident_notes *──1 incidents *──1 profiles

alerts *──1 profiles (drafted_by, approved_by)
alert_targets *──1 alerts (role or building)

weather_observations (singleton or time-series cache)

audit_logs (append-only; actor, action, entity, before/after JSONB)
```

**Implemented vs planned:** `profiles`, `audit_logs`, `schools`,
`location_categories`, `locations`, `schedules`, and `hazard_reports` exist
(migrations 0001–0008). `check_ins`, `report_attachments`, `incidents`,
`incident_status_history`, `incident_notes`, `alerts`, `alert_targets`, and
`weather_observations` are design targets from the original specification and
are not built yet.

**Migration note (Phase 2, approved):** the interim `buildings`/`floors`/`rooms`
tables from migration 0002 were replaced by the unified `locations` hierarchy
(migration 0003) after their row counts were verified as zero. Locations are
school-scoped and archive-only (no client deletes).

### 4.2 Key Tables (summary)

| Table | Key Columns | RLS |
|---|---|---|
| `schools` | id, name, status | Own school read; admin update own; provisioned via SQL/dashboard |
| `profiles` | id (=auth.uid), role, display_name, school_id, primary_location_id | User reads own; admin reads own-school only |
| `location_categories` | id, school_id, name (unique/school, ci), environment, is_active | Own-school read; admin insert/update; no delete (deactivate) |
| `locations` | id, school_id, parent_id (optional self-FK), category_id, name, code, environment, status, access_level | Own-school read; admin insert/update; **no client delete (archive-only)** |
| `schedules` | id, school_id, location_id, day_of_week (0–6), start_time, end_time, effective_from, effective_until, label, status | Own-school read (all roles); admin insert/update; **no client delete (deactivate)** |
| `check_ins` | id, profile_id, location_id, location_source, checked_in_at, period | *Planned* — user own write/read; responder building read |
| `hazard_reports` | id, school_id, reporter_id, location_id (optional), category, description, status | Implemented: own-school scope + **reporter or reviewer reads**; any role files own-school as self; responder/admin update status; **no client delete (retained)** |
| `report_attachments` | id, report_id, storage_path | *Planned* — via report RLS + storage policy |
| `incidents` | id, case_ref UNIQUE, status, created_by, assigned_to | Creator + responder/admin |
| `incident_status_history` | id, incident_id, from_status, to_status, actor_id | Same as incident |
| `incident_notes` | id, incident_id, author_id, body | Same |
| `alerts` | id, status (draft/approved/published/cancelled), content, target_role, target_building_id | Draft: author+admin; Published: all authenticated |
| `weather_observations` | id, source, observed_at, temp_c, humidity_pct, fetched_at, is_stale | Authenticated read; server write |
| `audit_logs` | id, actor_id, action, entity_type, entity_id, payload JSONB, created_at | Admin (own-school actors); insert via trigger/RPC only |

**Locations server-side validation** (trigger `validate_location`): same-school
parent (never archived when attaching), no self-parent, no cycles, depth ≤ 100,
category must match school/environment, case-insensitive sibling-name uniqueness
(among non-archived), code uniqueness per school (non-archived). `school_id` is
immutable (trigger). Historical FK references survive renames/archival because
records store location UUIDs.

**Schedules server-side validation** (trigger `validate_schedule`, migration
0006): friendly messages for `end_time > start_time` and
`effective_until >= effective_from`; the referenced location must exist, belong
to the same school, and not be archived (checked on insert/location change);
overlapping **active** times for the same location + weekday are rejected
(inactive rows never conflict; effective ranges must intersect, NULL
`effective_until` = open-ended). `school_id` is immutable (shared trigger);
changes are audited. A schedule row records where someone is *expected* — it is
never presented as verified occupancy.

**Hazard reports server-side validation** (trigger `validate_hazard_report`,
migration 0007): friendly messages for invalid category, description length
(3–2000), and a report that tries to start in a non-`open` status; a report
must be filed as the authenticated user (no filing on behalf of others); the
optional location must exist, belong to the same school, and not be archived.
After submission the report details are immutable, and status follows the
workflow `open → acknowledged → resolved` (one-step undo allowed:
`acknowledged → open`, `resolved → acknowledged`); any other transition is
rejected. `school_id` is immutable (shared trigger); creations and status
changes are audited. Reports are retained, not deleted.

**Hazard report read scope** (migration 0008, narrowing 0007): school scoping
is evaluated first, then role — a report is readable only by its **reporter** and
by **responder/administrator reviewers** of the same school. Other members of
the school (students, teachers) cannot read reports they did not file, which
keeps reporter identity and report content off unauthorised screens. The
"read all reports" permission therefore belongs to responders and
administrators only, as §1.2 states.

### 4.3 Enums / status values (check constraints)

- `app_role`: student, teacher_staff, responder, administrator, (system_operator)
- `schools.status` / `locations.status`: active, inactive, archived
- `locations.environment`: indoor, outdoor, covered
- `locations.access_level`: public, staff, restricted
- `location_categories.environment`: indoor, outdoor, either
- `schedules.status`: active, inactive
- `schedules.day_of_week`: 0–6 (0 = Sunday, JS `Date.getDay()` convention)
- `incident_status` *(planned)*: new, acknowledged, assigned, in_progress, resolved, closed, cancelled
- `report_status` (implemented, migration 0007): open, acknowledged, resolved
- `location_source` *(planned)*: self_selected, schedule_derived, staff_verified
- `alert_status` *(planned)*: draft, approved, published, corrected, cancelled
- `report_category` (implemented, migration 0007): facility_damage, safety_hazard, crowding, other

**Multi-school isolation (Phase 2):** every scoping table carries `school_id`;
RLS predicates compare against `my_school_id()` (security-definer helper).
Current pilot = single seeded school (`SENTINEL Test School`, fixed id
`11111111-1111-1111-1111-111111111111`); additional schools are provisioned
via SQL/dashboard only. Cross-school reads, writes, reassignment, and audit
visibility are tested in `scripts/verify-rls.mjs` §9.

---

## 5. Incident and Hazard Reporting Workflows

### 5.1 Hazard Report Flow

```
[User] ──submit──▶ INSERT hazard_reports (status=open)
                      │
                      ▼
              [Responder/Admin] review
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
   acknowledged    resolved   (one-step undo)
                      │
                      ▼
              audit_logs entry
```

**Acceptance:** Reporter sees own reports; only responder/admin change status; photos in private bucket with signed-URL access scoped by policy.

**Implemented (Phase 3, migration 0007):** the v1 vocabulary is
`open → acknowledged → resolved` (undo: `acknowledged → open`,
`resolved → acknowledged`); `under_review`/`dismissed` were folded into
`acknowledged`/`resolved` to keep the transition set minimal and enforceable
server-side. Any authenticated member of a school may file a report for that
school as themselves; reports are read by own-school members, changed only by
responder/administrator reviewers, and are never deleted by clients.

### 5.2 SOS / Incident Flow

```
[Student/Staff] ──SOS──▶ INSERT incidents
                            case_ref = SNT-YYYY-####
                            status = new
                                │
                    (auto-notify responders in-app)
                                │
[Responder] ──acknowledge──▶ status = acknowledged  (acknowledged_by, acknowledged_at)
[Responder] ──assign──────▶ status = assigned      (assigned_to)
[Responder] ──start───────▶ status = in_progress
[Responder] ──resolve─────▶ status = resolved      (resolution_notes)
[Responder/Admin] ──close─▶ status = closed
[Creator/Admin] ──cancel─▶ status = cancelled      (reason; history preserved)
```

**Rules:**
- Transitions enforced by a Postgres function `transition_incident(incident_id, new_status, note)` with role checks + history insert.
- Duplicate SOS: same user, same status=`new` or `in_progress`, within configurable cooldown (e.g., 5 min) → rejected with friendly message.
- Manual fallback documented in `docs/MANUAL_FALLBACK.md` (network/system down): paper log + radio/phone escalation to responders.

---

## 6. Emergency Notification and Response Workflows

### 6.1 In-App Alerts (MVP)

```
[Admin/Responder] ──draft──▶ alerts (status=draft, targets)
                                    │
                          [Approver] approve
                                    │
                                    ▼
                          alerts (status=published)
                                    │
                          Feeds to /alerts for targeted roles/buildings
                                    │
                          [Approver] correct → new version, old retained
                          [Approver] cancel  → status=cancelled, retained
```

- No external delivery in MVP. UI must never claim "SMS sent" or "email delivered."
- Post-MVP (E1): evaluate cost/privacy of email/SMS/push before any integration.

### 6.2 Response Notification to SOS

When `incidents.status` becomes `new`, a database trigger or client-side RPC inserts an `alerts` row (or lightweight `incident_notifications`) visible to `responder` + `administrator`. No push/SMS in MVP.

---

## 7. Dashboard Metrics and Computational Rules

### 7.1 Metrics per Role

| Role | Dashboard Content |
|---|---|
| student | Own check-in status today; own incident status if any; published alerts |
| teacher_staff | Building check-in count / expected; open hazard reports in building; alerts |
| responder | Open incident queue by status; assigned to me; unacknowledged age; weather advisory |
| administrator | All metrics; user counts; audit summary; weather + heat-index advisory |

**Privacy:** Aggregates must not expose individual student locations to unauthorized roles (e.g., student dashboards show only own data; teacher dashboards show counts, not individual names unless policy explicitly allows — default: counts only).

### 7.2 Heat-Index Computation

**Formula:** NWS Rothfusz regression (documented in `docs/HEAT_INDEX.md`).

```
HI = -42.379 + 2.04901523*T + 10.14333127*RH
     - 0.22475541*T*RH - 0.00683783*T*T - 0.05481717*RH*RH
     + 0.00122874*T*T*RH + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH
```

Where T = dry-bulb temperature (°F), RH = relative humidity (%).

**Applicability:** Valid when T ≥ 80°F and RH ≥ 40% (approx.). Below that, return "not applicable" rather than a misleading number.

**Freshness:** Weather observation older than `FRESHNESS_THRESHOLD_MINUTES` (e.g., 30) → `is_stale=true`; UI shows "Data may be outdated" and does not present the number as current.

**Disclaimer (must appear in UI):** "External weather data are not indoor classroom measurements. This value is advisory only and does not automatically suspend classes or trigger emergency actions."

**Units:** Store metric (°C) in DB; compute in °F per NWS formula; display with unit toggle if needed. Document conversion.

**Rule version:** Store `rule_version` (e.g., `heat_index_v1`) alongside each computed advisory.

---

## 8. Audit Logging and Record Retention

### 8.1 What Is Audited

| Action | Logged |
|---|---|
| Role changes | ✓ |
| Incident status transitions | ✓ (via status_history; also audit_logs) |
| Alert approve/publish/correct/cancel | ✓ |
| Admin CRUD on school structure | ✓ |
| Hazard report creation and status changes | ✓ (trigger `hazard_reports_audit`) |
| User sign-in (auth logs handled by Supabase) | Supabase auth audit |

### 8.2 Retention (Proposed Defaults)

| Data | Retention | Notes |
|---|---|---|
| Check-ins | 90 days then anonymize/archive | Minimize PII |
| Hazard reports | 1 year | School policy review |
| Incidents + history | 3 years | Compliance/safety review |
| Audit logs | 3 years | Append-only |
| Weather observations | 30 days raw; daily aggregate 1 year | Storage cost control |
| Report photos | 1 year or until report closed + 90 days | Private bucket lifecycle |

Deletion jobs (post-MVP) must be documented; no hard-delete of audit logs.

---

## 9. Authentication and Authorization

### 9.1 Auth (Supabase Auth)

- Email + password (MVP). Magic link / SSO: post-MVP.
- Email confirmation: enabled.
- Redirect URLs: localhost (dev) + Cloudflare Pages staging/production domains (configured in Supabase dashboard at deploy time).
- Session: Supabase JS handles storage; default is fine for MVP.

### 9.2 First Administrator Provisioning

Documented in `docs/FIRST_ADMIN.md`:
1. Deployer signs up with a designated email.
2. Via Supabase SQL Editor (or service_role script), set `profiles.role = 'administrator'` for that user id — one-time, manual, audited.
3. Subsequent admins created by existing admin in-app.

### 9.3 Authorization Layers

| Layer | Enforces |
|---|---|
| RLS policies | Row-level read/write per role |
| Postgres functions/RPC | Privileged transitions (role change, incident transition, alert approve) |
| Cloudflare Functions | Secret access (weather key); optional server-side checks |
| Frontend Route guards | UX only — **not security** |

---

## 10. Error Handling and Validation

### 10.1 Principles

- Never leak stack traces, SQL errors, or keys to the UI.
- User-facing messages: actionable ("Could not submit report. Check your connection and try again.").
- Log detailed errors server-side (Cloudflare logs / Supabase logs) with request id, no secrets.

### 10.2 Validation

| Input | Client | Server (DB/CF) |
|---|---|---|
| Text fields | Length, required | CHECK constraints, max length |
| Enums | Select-only UI | CHECK against enum |
| File uploads | Type/size preview | MIME allowlist, size limit, scan (post-MVP) |
| Numeric (weather) | — | Range checks before heat-index |
| Hazard report | Category select, description 3–2000 | Trigger `validate_hazard_report`: category allowlist, length, reporter identity, location scope, status workflow |

### 10.3 Failure Modes to Handle

- Network offline during check-in/SOS → clear retry UI; no silent success.
- Supabase down → friendly maintenance message.
- Weather fetch fail → dashboard shows "Weather unavailable."
- Duplicate SOS → cooldown message, not raw constraint error.
- Unauthorized API call → 403 handled as "You do not have permission."

---

## 11. Testing and Deployment Architecture

### 11.1 Test Stack [PROPOSED]

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure functions (heat-index, ref gen, workflow transitions) |
| Component | Vitest + RTL | Forms, dashboards, guards |
| Integration | Vitest + mocked Supabase | Auth flow, API calls |
| RLS/Security | Script against real staging Supabase | Role × table matrix |
| E2E (post-MVP) | Playwright | Critical SOS path |

**Commands (to exist in package.json):**
```json
"dev": "vite",
"build": "tsc -b && vite build",
"lint": "oxlint",
"test": "vitest run",
"typecheck": "tsc -b --noEmit"
```

### 11.2 CI (Optional, post-MVP)

GitHub Actions: lint + test + build on PR. No deploy without manual gate.

### 11.3 Deployment

| Stage | Target | Trigger |
|---|---|---|
| Local | `npm run dev` | Developer |
| Staging | Cloudflare Pages (branch `staging` or `main` preview) | Manual / push to staging branch |
| Production | Cloudflare Pages (branch `main`) | Explicit approval only |

**Build:** `npm run build` → output `dist/`.
**Env vars:**

| Name | Where | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | CF Pages env | No (public) |
| `VITE_SUPABASE_ANON_KEY` | CF Pages env | No (public, RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | CF Functions env only | **Yes** |
| `WEATHER_API_KEY` (if needed) | CF Functions env only | **Yes** |

### 11.4 Rollback

- Git revert + redeploy previous build.
- DB migrations: forward-only in MVP; each migration reviewed and applied via SQL Editor with backup note. No `supabase db reset` against shared project.

---

## Shared Contracts (All Developers Must Follow)

1. **Naming:** snake_case in SQL; camelCase in TS; `PascalCase` components.
2. **Migrations:** Sequential `supabase/migrations/NNNN_description.sql`; never edit applied migration; new migration for changes.
3. **RLS:** Every new table gets RLS enabled + policies in the same migration. No exceptions.
4. **Env:** Only `VITE_`-prefixed vars in frontend; secrets only in CF Functions env.
5. **Status enums:** Use Postgres enums; TS union types mirrored in `src/lib/types.ts`.
6. **Case reference format:** `SNT-YYYY-####` (zero-padded sequence per year).
7. **Heat-index rule version:** Bump `heat_index_vN` when formula/inputs change; store with advisory.
8. **No real PII** in dev/test; synthetic names only.
9. **Audit:** Privileged actions go through RPC/trigger that writes `audit_logs`.
10. **Docs:** Update `docs/DEVELOPMENT_LOG.md` per task (phase, task id, files, tests, gate status).

---

## Confirmed vs Proposed Summary

| Item | Status |
|---|---|
| Vite + React + TS + oxlint scaffold | **[CONFIRMED]** |
| GitHub remote `cshs-sentinel/main` (branch `main`) | **[CONFIRMED]** |
| Supabase project `vuqjfigoeuvjieznqyil` (auth, Postgres, RLS) | **[CONFIRMED]** — in use; migrations 0001–0008 applied |
| Cloudflare Pages hosting | **[PROPOSED]** — deploy only after the Phase 9 gate |
| Schema/RLS for identity, structure, schedules, hazard reports | **[CONFIRMED]** (migrations 0001–0008) |
| Check-ins, report photos, SOS/incidents, alerts, weather, dashboard | **[PROPOSED]** — later phases, not built |
| Open-Meteo as weather source | **[PROPOSED]** (confirm at Phase 6) |

---

## Awaiting Approval

This document was approved as the architecture baseline (Gate Architecture → Task 1.1
scaffold) and is now the **living** specification: implemented sections are marked
in §2.1, §4.2, §4.3 and §1.2, and each change is recorded in
`docs/DEVELOPMENT_LOG.md`. No further implementation proceeds without a task
plan approved per `AGENTS.md` §6, and no deployment or production change happens
before the Phase 9 gate.
