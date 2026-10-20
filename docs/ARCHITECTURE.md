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

---

## 2. Frontend Pages and Navigation

**[PROPOSED]** React Router (or TanStack Router) with route guards.

### 2.1 Route Map

| Route | Page | Guard | Role(s) |
|---|---|---|---|
| `/login` | Sign in | Public | — |
| `/signup` | Sign up | Public | — |
| `/` | Redirect by role | Auth | All |
| `/check-in` | Check-in button + history | Auth | student, teacher_staff, responder, admin |
| `/schedule` | Own schedule | Auth | All |
| `/reports/new` | Hazard report form | Auth | All |
| `/reports/:id` | Report detail | Auth | Reporter + responder + admin |
| `/sos` | SOS trigger + case ref | Auth | All |
| `/incidents` | Incident list (role-filtered) | Auth + role | responder, admin |
| `/incidents/:ref` | Incident detail + timeline | Auth + role | responder, admin |
| `/dashboard` | Role-specific dashboard | Auth + role | All (variant) |
| `/admin/users` | User management | Auth | administrator |
| `/admin/structure` | Buildings/rooms CRUD | Auth | administrator |
| `/admin/schedules` | Schedule management | Auth | administrator |
| `/alerts` | Alert feed | Auth | All |
| `/admin/alerts/new` | Alert composer | Auth | responder (approver), admin |

### 2.2 Navigation Shell

Mobile-first bottom nav (student view): **Home | Check-In | SOS | Alerts | More**
Staff/responder: adds **Reports | Incidents**
Admin: adds **Admin**

**[CONFIRMED]** Current `App.tsx` is Vite template only — will be replaced by router + shell.

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
profiles 1──1 auth.users
profiles *──* app_role (via profiles.role)

buildings 1──* floors 1──* rooms
rooms 1──* schedules *──1 profiles (user)

check_ins *──1 profiles
check_ins *──1 rooms (optional)

hazard_reports *──1 profiles (reporter)
hazard_reports *──1 rooms (optional)
report_attachments *──1 hazard_reports  → storage bucket: report-photos (private)

incidents *──1 profiles (creator)
incidents *──1 profiles (acknowledged_by, assigned_to nullable)
incident_status_history *──1 incidents
incident_notes *──1 incidents *──1 profiles

alerts *──1 profiles (drafted_by, approved_by)
alert_targets *──1 alerts (role or building)

weather_observations (singleton or time-series cache)

audit_logs (append-only; actor, action, entity, before/after JSONB)
```

### 4.2 Key Tables (summary)

| Table | Key Columns | RLS |
|---|---|---|
| `profiles` | id (=auth.uid), role, display_name, building_id | User reads own; admin reads all |
| `buildings` | id, name | All authenticated read; admin write |
| `floors` | id, building_id, label | Same |
| `rooms` | id, floor_id, code, name | Same |
| `schedules` | id, profile_id, room_id, valid_from, valid_to, day_of_week | User own; staff building |
| `check_ins` | id, profile_id, room_id, location_source, checked_in_at, period | User own write/read; responder building read |
| `hazard_reports` | id, reporter_id, category, description, room_id, status | Reporter + responder/admin |
| `report_attachments` | id, report_id, storage_path | Via report RLS + storage policy |
| `incidents` | id, case_ref UNIQUE, status, created_by, assigned_to | Creator + responder/admin |
| `incident_status_history` | id, incident_id, from_status, to_status, actor_id | Same as incident |
| `incident_notes` | id, incident_id, author_id, body | Same |
| `alerts` | id, status (draft/approved/published/cancelled), content, target_role, target_building_id | Draft: author+admin; Published: all authenticated |
| `weather_observations` | id, source, observed_at, temp_c, humidity_pct, fetched_at, is_stale | Authenticated read; server write |
| `audit_logs` | id, actor_id, action, entity_type, entity_id, payload JSONB, created_at | Admin read; insert via trigger/RPC only |

### 4.3 Enums

- `app_role`: student, teacher_staff, responder, administrator, (system_operator)
- `incident_status`: new, acknowledged, assigned, in_progress, resolved, closed, cancelled
- `report_status`: submitted, under_review, resolved, dismissed
- `location_source`: self_selected, schedule_derived, staff_verified
- `alert_status`: draft, approved, published, corrected, cancelled
- `report_category`: hazard, maintenance, health, security, other

---

## 5. Incident and Hazard Reporting Workflows

### 5.1 Hazard Report Flow

```
[User] ──submit──▶ INSERT hazard_reports (status=submitted)
                      │
                      ▼
              [Responder/Admin] review
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     under_review   resolved    dismissed
                      │
                      ▼
              audit_logs entry
```

**Acceptance:** Reporter sees own reports; only responder/admin change status; photos in private bucket with signed-URL access scoped by policy.

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
| GitHub remote `BossG-Innovation2026/sentinel` | **[CONFIRMED]** |
| New detached Supabase project | **[PROPOSED]** (user approved concept; project not created yet) |
| Cloudflare Pages hosting | **[PROPOSED]** |
| All schema, RLS, UI, workflows, tests | **[PROPOSED]** |
| Open-Meteo as weather source | **[PROPOSED]** (confirm at Phase 7) |

---

## Awaiting Approval

This architecture document is **proposed**. Approval of this document (Gate Architecture) authorizes implementation starting with roadmap **Task 1.1** (secure scaffold + test harness). No schema is applied, no services are provisioned, and no feature code is written until then.
