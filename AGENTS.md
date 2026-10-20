# SENTINEL Project Rules for OpenCode

> These instructions apply to the MCSI-08 SENTINEL project. Follow them before making changes.

## 1. Project mission

Develop **MCSI-08 SENTINEL** — Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and Logistics — as a mobile-first school safety and incident-coordination web application.

The system may support:
- Sign-in and role-based access
- School buildings, floors, rooms, and schedule-derived expected locations
- Safety check-ins and hazard reports
- SOS submissions and incident response workflows
- A role-filtered administrative dashboard
- Server-side weather-data ingestion and documented heat-index calculations
- Human-approved alerts and notification history
- Audit trails, testing, and controlled deployment

The system supports school personnel; it does not replace emergency services, school leadership, or official decision-making.

## 2. Mandatory working rules

1. **Inspect before editing.** Read repository instructions, README, package scripts, source structure, database migrations, tests, Git status, current branch, and recent commits.
2. **Preserve existing work.** Do not replace the existing framework, restructure the whole repository, discard local changes, or recreate the application from scratch without explicit approval.
3. **Work in small increments.** Implement one bounded task at a time. Do not attempt the whole application in one prompt.
4. **Plan before coding.** State the task, files likely to change, assumptions, risks, and acceptance criteria. For changes larger than a small bug fix, wait for user approval.
5. **Use Git safely.** Check `git status` before and after work. Never discard, reset, clean, or overwrite user changes. Prefer a feature branch for each substantial feature.
6. **Test what changed.** Run relevant tests and the existing lint, type-check, and build commands when available. Never claim a command passed unless it was actually run and its result checked.
7. **Review the diff.** Summarize added/modified files, database changes, behavior, test results, and unresolved issues.
8. **Ask before high-impact actions.** Do not deploy, delete data, reset a database, run destructive migrations, alter production secrets, or send real alerts without explicit approval.
9. **Use synthetic data** in development and demonstrations. Do not invent real learner or staff records.
10. **Do not fake completion.** Clearly distinguish implemented, locally tested, deployed, and externally verified functionality.

## 3. Technology and cost constraints

- First identify the technology already used by the repository; keep it unless there is a documented reason to change it.
- GitHub is the source-control platform.
- Target Cloudflare Pages or Cloudflare Workers for hosting and server-side functions, choosing the option compatible with the current project.
- Use the existing Supabase project for PostgreSQL, authentication, Row Level Security (RLS), and private storage where appropriate.
- Prefer free-tier-compatible services. Before relying on a service, check current limits, inactivity/pause behavior, quotas, and possible charges.
- Do not add paid services, frameworks, microservices, or dependencies without explaining the need and obtaining approval.
- Commit database migrations to Git. If Supabase CLI setup is blocked, explain the blocker and propose a safe, reviewed SQL Editor fallback without losing migration history.

## 4. Security and privacy rules

- Never put Supabase `service_role` keys, database passwords, or other privileged secrets in browser code, public environment variables, source control, screenshots, or logs.
- Keep secrets in the hosting provider's server-side secret/environment settings.
- A public/publishable Supabase key may be used in browser code only when the application's RLS policies correctly protect every exposed table and storage object.
- Enable and test RLS for all exposed tables. UI hiding is not authorization.
- Test access using different roles and direct API/database requests, not just the interface.
- Users must not grant themselves administrator or responder privileges.
- Use private storage for sensitive photos and records; enforce authorized access.
- Validate inputs and uploads on the server; handle errors without leaking secrets or sensitive data.
- Minimize personal data. Document access, retention, deletion, backup, and recovery expectations.
- Protect identifiable schedules, location information, check-ins, SOS records, incident notes, and learner information.
- Add audit history for important administrative and incident actions.
- Do not add tracking, analytics, or third-party integrations without explaining privacy implications.

## 5. Functional rules

### Identity and roles
Use only roles justified by the requirements, such as student, teacher/staff, responder, administrator, and system operator. Enforce permissions server-side and through RLS. Document how the first administrator is securely provisioned.

### School structure and schedules
Support buildings, floors, rooms, room codes, and effective-dated schedules where required. Label location information as user-selected, schedule-derived, or staff-verified. **A scheduled room is not proof of a person's actual location or occupancy.**

### Safety check-ins and hazard reports
Capture only necessary information. Support category, description, optional room/location context, timestamp, status, and optional private photo. Make submission errors and successful receipt clear.

### SOS and incident workflow
Support a unique case reference, acknowledgement, assignment, status history, response notes, resolution, and closure. A suggested workflow is:
`NEW → ACKNOWLEDGED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED`
Allow documented cancellation/false-alarm handling without erasing the history. Add duplicate protection where practical. Document manual fallback procedures if the system or network is unavailable.

### Weather and computational rules
Fetch weather data server-side where possible. Store source, timestamp, units, freshness, and calculation-rule version. Validate input ranges and formula applicability. Test the heat-index calculation against reliable reference cases. **External weather data are not indoor classroom measurements.** Do not automatically suspend classes or make emergency decisions solely from a computed threshold.

### Dashboard
Use role-filtered views and appropriately aggregated summaries. Show stale/missing weather data clearly. Do not expose private records to unauthorized users.

### Alerts
Start with in-app alerts. Require authorized human review before official broadcasts. Keep draft, approval, publication, correction, cancellation, and delivery-attempt history. Do not claim an email/SMS/push message was delivered unless the provider confirms delivery.

## 6. Required development cycle

For each task, follow this cycle:

1. **Inspect:** Check relevant code, instructions, Git state, tests, and dependencies.
2. **Define:** State one problem, acceptance criteria, risks, and out-of-scope work.
3. **Plan:** List intended files and a minimal implementation approach.
4. **Confirm:** Wait for approval for substantial, security-sensitive, database, or deployment changes.
5. **Implement:** Make the smallest coherent change.
6. **Test:** Run relevant tests and available lint/type/build checks.
7. **Review:** Inspect the diff for regressions, secrets, unsafe permissions, and unrelated edits.
8. **Report:** Explain what changed, what was tested, what remains, and the next proposed task.
9. **Commit:** Suggest a clear commit message; do not commit or push unless the user has authorized that workflow.

## 7. Phased roadmap and approval gates

### Phase 0 — Repository audit and readiness
Do not implement features yet. Identify the framework, architecture, commands, current branch/working-tree state, existing features, Supabase integration, Cloudflare configuration, tests, secrets handling, and gaps. Produce a readiness report and recommend one smallest safe next task.

**Gate 0:** User reviews and approves the plan.

### Phase 1 — Foundation, database, identity, and RLS
Confirm environment configuration and migration workflow. Review schema. Implement only the approved foundation, identity, role provisioning, and access policies. Add role-based authorization tests.

**Gate 1:** Schema and access rules reviewed; migration and rollback/recovery approach understood; tests pass.

### Phase 2 — School structure and schedules
Implement buildings/floors/rooms and schedule-derived expected locations only after Phase 1 is stable. Test time boundaries, inactive schedules, and permissions.

**Gate 2:** Authorized users see only permitted school data; schedule data are not presented as verified occupancy.

### Phase 3 — Check-ins and hazard reports
Implement a small complete flow from submission through authorized review, including private media only if approved. Test validation, permissions, and storage access.

**Gate 3:** Unauthorized users cannot read private reports or media.

### Phase 4 — SOS and incident response
Implement case creation, acknowledgement, assignment, status transitions, notes, and audit history. Test duplicate submissions, failed requests, role restrictions, and manual fallback documentation.

**Gate 4:** End-to-end test succeeds in a non-production environment; response responsibilities are documented.

### Phase 5 — Dashboard and reporting
Implement only role-appropriate queue, room/building summaries, and incident/report views. Check for accidental disclosure through summaries and exports.

**Gate 5:** Dashboard data match authorized source records and pass role-based tests.

### Phase 6 — Weather and computation
Implement server-side weather retrieval and a separately tested calculation module. Validate units, timestamps, missing/stale data, boundary conditions, and formula applicability.

**Gate 6:** Reference test cases pass; stale data and uncertainty are visible; no automatic official decision is made.

### Phase 7 — Alerts
Start with in-app alerts. Add official publication workflow and audit history. Consider external channels only after provider costs, secrets, privacy, and delivery semantics are reviewed.

**Gate 7:** Only authorized approvers can publish; correction/cancellation and failed delivery are handled.

### Phase 8 — Security, accessibility, and reliability
Test RLS directly, authorization, input validation, upload restrictions, accessibility, responsive layouts, error states, backups, and restore procedures.

**Gate 8:** No unresolved critical/high-risk issue is accepted silently. Record limitations and mitigations.

### Phase 9 — Deployment and controlled pilot
Deploy to a test/staging environment first. Verify environment variables, migrations, authentication redirects, RLS, logs, backup/restore, manual fallback, and school authorization. Obtain explicit approval before production deployment or real alerts.

**Gate 9:** Pilot checklist signed off by the responsible school authority.

## 8. Completion report format

At the end of each task, provide:

1. **Task and status:** implemented / tested / deployed / externally verified (use only applicable statuses).
2. **Changes:** files added or modified and why.
3. **Database:** migrations, commands, and any manual steps.
4. **Tests:** exact commands run and actual outcomes.
5. **Security/privacy:** permission changes, data exposure risks, secrets, and mitigations.
6. **Manual configuration:** dashboard settings, environment variables, or credentials still needed (never print secret values).
7. **Known limitations:** failures, untested paths, and risks.
8. **Git:** branch and working-tree state; suggested commit message.
9. **Next step:** one bounded recommendation, not an unapproved batch of features.

## 9. First instruction

Begin with **Phase 0 only**. Inspect the existing repository and return a concise readiness report. Do not implement features, change dependencies, alter database state, or deploy. Recommend the smallest safe next task and wait for approval.
