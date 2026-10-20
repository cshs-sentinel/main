# MCSI-08 SENTINEL — OpenCode Vibe-Coding and Deployment Guide

**Purpose:** Use this guide with OpenCode to develop SENTINEL incrementally, preserve the existing MCS12 project, and deploy through free-tier services with explicit approval gates.

## 1. How to use these files

Place both files in the root of the existing repository:

- `AGENTS.md` — persistent project rules OpenCode should follow.
- `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` — human-readable step-by-step workflow and prompts.

If the repository already has an `AGENTS.md`, do not overwrite it blindly. Compare the files and merge the SENTINEL rules while preserving project-specific instructions. Ask OpenCode to read both files before beginning.

## 2. Recommended architecture

Keep the existing repository architecture where possible. The target architecture is:

- **User interface:** responsive, mobile-first web application.
- **Source control:** Git and GitHub.
- **Hosting:** Cloudflare Pages or Cloudflare Workers, selected based on the existing framework and its current compatibility.
- **Backend/data:** existing Supabase project for PostgreSQL, authentication, RLS, and private storage where appropriate.
- **External data:** weather provider accessed server-side where practical.
- **Notifications:** in-app notifications first; external email/SMS/push is optional and must be reviewed for cost and privacy.

Free-tier services have quotas and may change. Confirm current pricing, limits, inactivity rules, and service behavior before deployment. A free tier is suitable for a prototype or limited pilot, not a promise of uninterrupted production-grade emergency service.

## 3. Before starting: protect the current project

Open PowerShell or a terminal in the existing MCS12 repository.

```powershell
git status
git branch --show-current
git log -5 --oneline
```

Review the output. If there are uncommitted changes, do not discard them. Make a backup or commit only if appropriate and authorized. Confirm the correct repository path before proceeding.

Start OpenCode:

```powershell
opencode
```

Use `/init` if the repository has not yet been initialized with OpenCode instructions. Review the generated instructions before accepting them. Preserve existing documentation and project structure.

Ask OpenCode to inspect the repository before editing. Do not ask it to build all modules in one prompt.

## 4. First prompt — audit only

Paste this into OpenCode:

> Read `AGENTS.md`, `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md`, and the existing project documentation. Follow the repository rules.
>
> Perform **Phase 0: repository audit only**. Do not edit files, install packages, change branches, modify the database, or deploy.
>
> Inspect the current branch and Git working tree, framework, package scripts, app structure, database migrations/schema, authentication, RLS, Supabase integration, Cloudflare configuration, tests, environment-variable handling, and existing functionality.
>
> Return:
> 1. Current architecture and how the app runs.
> 2. What is already implemented and what is missing.
> 3. Relevant files and commands.
> 4. Security/privacy and deployment risks.
> 5. Any blocked setup steps.
> 6. A prioritized phased plan.
> 7. The **smallest safe next task**, with acceptance criteria and files likely to change.
>
> Stop and wait for my approval.

Review the report yourself. Correct mistaken assumptions. Approve only the next bounded task.

## 5. The repeatable vibe-coding loop

Use the following loop for every task.

1. **One outcome:** Ask for one small, testable behavior.
2. **Acceptance criteria:** Define observable conditions that prove it works.
3. **Plan first:** Ask OpenCode to name files, dependencies, database changes, and risks.
4. **Approve:** Review the plan before substantial changes.
5. **Implement:** Ask it to implement only the approved scope.
6. **Test:** Require relevant tests and the existing lint/type/build commands.
7. **Inspect:** Review the diff and test output; confirm there are no unrelated changes or secrets.
8. **Demonstrate:** Run the application and test the behavior manually.
9. **Record:** Update docs and migration instructions where needed.
10. **Commit:** Commit only when you have reviewed the changes and authorized the Git operation.
11. **Next task:** Move to the next phase only when the current approval gate is satisfied.

### Reusable task prompt

> Work under `AGENTS.md`. The current approved task is: **[describe one outcome]**.
>
> Before editing, inspect the relevant code and Git status. Propose the smallest implementation, list likely files, define acceptance criteria, and identify security, privacy, database, and deployment implications. Wait for my approval before substantial changes.
>
> After approval, implement only this task. Preserve existing behavior and unrelated changes. Add/update tests. Run the commands that are actually defined by the project. Review the diff. Do not deploy or perform destructive actions.
>
> Report files changed, commands and results, migration/manual setup, security implications, unresolved issues, and one recommended next task. Never claim success without evidence.

## 6. Development phases and practical deliverables

The schedule below is a suggested sequence, not a deadline. Do not skip a gate merely to meet a calendar target.

| Phase | Scope | Completion evidence |
|---|---|---|
| 0. Audit | Inspect repository, framework, tests, Supabase, Cloudflare | Readiness report; approved plan |
| 1. Foundation | Environment setup, migrations, identity, roles, RLS | Migration reviewed; role/access tests pass |
| 2. School structure | Buildings, floors, rooms, effective-dated schedules | Authorized views; schedule ≠ verified occupancy |
| 3. Check-ins/reports | Safety check-ins, hazard reports, private attachments if needed | Submission/review flow; private access tests |
| 4. SOS/incidents | Case reference, acknowledgement, assignment, status history, audit | End-to-end incident test; manual fallback |
| 5. Dashboard | Role-filtered queues and summaries | Data accuracy and access tests |
| 6. Computation | Weather ingestion, formula, validation, freshness, rule version | Reference and boundary tests; stale-data handling |
| 7. Alerts | In-app notifications, approval, publication, correction/cancellation | Only authorized approvers can publish |
| 8. Hardening | RLS, validation, accessibility, error handling, backups/restore | Test report and risk register |
| 9. Pilot/deploy | Staging, configuration, migration, smoke tests, authorization | Signed-off pilot checklist |

### Phase 1 prompt — only after Gate 0 approval

> Implement only the approved foundation task from the Phase 0 report. First verify the current schema and migration workflow. Propose the minimum migration and role model before changing database files. Keep migrations in version control. Add RLS policies and tests for permitted and forbidden access. Never expose a privileged Supabase key in browser code. If CLI authentication or environment variables are blocked, stop and explain the blocker; do not invent credentials or silently change the database workflow.

### Phase 2 prompt — school structure and schedules

> Implement only the approved school-structure slice. Include the minimum necessary building/floor/room data and schedule validity dates. Label schedule-derived locations as expected locations, not confirmed physical locations. Add tests for inactive/overlapping schedules, time boundaries, and role permissions. Do not import real student data; use synthetic records.

### Phase 3 prompt — reports

> Implement one complete hazard-report flow from form validation through database persistence and authorized review. Include safe error handling and access-control tests. If image upload is not already configured, propose a private-storage design before implementing it. Do not make report data or media publicly accessible.

### Phase 4 prompt — SOS and incident workflow

> Implement the approved incident workflow only: create a case reference, acknowledge, assign, update status, record response notes, resolve, close, and retain history. Add duplicate protection where practical and tests for unauthorized transitions and failed requests. Document the manual fallback if the network or application is unavailable. Do not send real notifications or deploy.

### Phase 5 prompt — dashboard

> Implement the smallest role-appropriate dashboard slice. Reuse existing components and query patterns. Avoid exposing names, locations, notes, or reports to roles that do not need them. Test permissions at the database/API layer as well as the UI. Do not add unrelated charts or features.

### Phase 6 prompt — weather and calculation

> Separate weather retrieval from the computational module. Document the formula, units, valid input ranges, applicability conditions, data source, timestamp, freshness rules, and calculation-rule version. Add unit tests for known reference cases and edge cases. Show missing or stale data explicitly. Do not treat external weather as indoor measurements or make automatic class-suspension decisions.

### Phase 7 prompt — alerts

> Start with in-app alerts. Implement draft, preview, approval, publish, correction, cancellation, and audit history as appropriate. Enforce publisher permissions server-side. Do not integrate paid SMS/push/email services until their cost, privacy, secret storage, and delivery-status behavior are reviewed and approved. Never label an alert as delivered without provider confirmation.

### Phase 8 prompt — hardening

> Conduct a focused test and security review of implemented functionality. Test RLS and direct API access for each role, session/authorization behavior, input validation, upload restrictions, sensitive logs, stale external data, mobile layout, accessibility, failure states, and backup/restore instructions. Do not claim the system is production-ready if critical tests remain unrun or unresolved. Produce a prioritized defect/risk list.

## 7. Local test commands

OpenCode must inspect `package.json` and project documentation first. Use only commands that exist in the current project. Common examples include:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

These are examples, not a claim that all scripts exist. If a command is absent, report that clearly rather than adding a new toolchain without approval.

Manual checks should include:
- Correct and incorrect sign-in/role access
- Unauthorized direct API/database requests
- Report creation and status visibility
- SOS creation, acknowledgement, assignment, resolution, and history
- Duplicate submissions and network failures
- Private attachment access
- Missing, invalid, and stale weather inputs
- Alert approval, correction, cancellation, and provider failures
- Mobile layout, keyboard access, and useful error messages

Use synthetic accounts and synthetic data in development.

## 8. Environment variables and secrets

1. Ask OpenCode to identify the framework and list the exact environment variable names required by the existing code.
2. Create local environment files only according to the repository's conventions.
3. Confirm secret-bearing files are ignored by Git. Never paste secret values into prompts, commits, public issue trackers, or screenshots.
4. Use hosting-platform environment settings for deployed secrets.
5. Browser-exposed variables (for example, framework-specific `VITE_` variables) are public. Only use a Supabase publishable/anon key in the browser, and only with correctly tested RLS.
6. Keep service-role keys, database passwords, and provider secrets server-side only.
7. If the application cannot be configured because a secret or account permission is missing, stop and request the required manual action. Never fabricate a secret.

## 9. Free-tier deployment workflow

Use staging/test deployment first. Verify current provider documentation and limits before following the steps, because free plans and quotas can change.

### A. GitHub
- Confirm the intended repository and branch.
- Review `git diff` and tests.
- Push only the approved branch using the repository's normal workflow.
- Do not commit `.env` files, private keys, real learner records, or production exports.

### B. Cloudflare Pages or Workers
- Choose Pages or Workers based on the current framework and existing project configuration.
- Connect the correct GitHub repository and deployment branch.
- Configure the real build command and output directory based on the repository; do not guess them.
- Configure only the required environment variables/secrets for the correct environment.
- Deploy a test branch first and review build logs.
- Smoke-test sign-in, navigation, database access, permissions, error states, and mobile layout.
- Confirm server-side functions do not expose secrets or bypass authorization.
- Do not switch production traffic until the test deployment passes and the user explicitly approves.

### C. Supabase
- Verify the correct project before running any SQL or migration.
- Review migrations and RLS policies before applying them.
- Back up important data where supported and understand recovery options.
- Keep production and test environments separated when feasible.
- Confirm authentication redirect URLs and site URLs match the deployment.
- Verify every exposed table and storage bucket has appropriate policies.
- Test as each role and with unauthorized requests.
- Confirm free-tier limits, inactivity/pause behavior, backups, and recovery constraints.
- Never run a reset, destructive migration, or production data change without explicit approval.

### D. Deployment smoke-test prompt

> Prepare a staging deployment checklist for the current repository. First identify the actual framework, build command, output directory, runtime functions, and required environment variables from the code and provider configuration. Do not deploy yet. List each required dashboard setting, which values are public versus secret, the database migration order, authentication URL settings, rollback approach, and smoke tests. Identify any possible paid usage or free-tier limitation. Wait for approval before deployment.

### E. After approval, deploy in controlled steps
1. Review the branch, diff, and test results.
2. Apply only reviewed migrations to the intended Supabase environment.
3. Set the approved environment variables/secrets in Cloudflare.
4. Deploy to staging/test.
5. Test authentication, roles, RLS, reports, SOS, calculations, and alerts.
6. Inspect logs for errors and secret leakage.
7. Verify backup/recovery and manual fallback instructions.
8. Obtain school authorization and explicit user approval before production deployment or real notifications.

## 10. Pilot-readiness checklist

Mark each item only after evidence has been reviewed.

- [ ] School leadership has approved the pilot scope, users, responsibilities, and data handling.
- [ ] Test accounts use appropriate roles; privileged accounts are securely provisioned.
- [ ] RLS and direct API authorization tests pass for allowed and forbidden actions.
- [ ] No privileged secrets are present in browser assets, Git, or logs.
- [ ] SOS flow works end-to-end in a test environment.
- [ ] Manual fallback and emergency escalation instructions are available.
- [ ] Incident updates and administrative actions retain an audit trail.
- [ ] Private reports and photos cannot be accessed by unauthorized users.
- [ ] Weather source, timestamp, units, freshness, formula, and applicability are visible/documented.
- [ ] Missing/stale external data fail safely.
- [ ] Official alerts require approval; correction/cancellation paths are tested.
- [ ] Backup and restore approach is understood and tested where feasible.
- [ ] Mobile usability, keyboard accessibility, and error states have been reviewed.
- [ ] Free-tier limits, inactivity behavior, and possible costs have been checked.
- [ ] Known limitations and unresolved risks are documented.
- [ ] Production deployment and real notifications have explicit approval.

## 11. Suggested task tracking

Maintain a small `docs/DEVELOPMENT_LOG.md` or issue list with:
- Phase and task ID
- Goal and acceptance criteria
- Branch/commit
- Files and migrations changed
- Tests run and results
- Manual setup required
- Security/privacy review
- Remaining risks
- Approval-gate status

Do not place credentials, personal records, or sensitive incident examples in the log.

## 12. Final instruction to OpenCode

Always follow `AGENTS.md`. Start with the Phase 0 audit. Do not implement the entire system in one session. At each gate, stop, report evidence, and wait for approval before proceeding. Prioritize correctness, access control, privacy, maintainability, and a safe pilot over feature count or visual polish.
