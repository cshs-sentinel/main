# SENTINEL — Risk and Defect Register

Required by `AGENTS.md` §7 (Phase 8): *"Record limitations and mitigations"* and
*"Produce a prioritized defect/risk list."* Status line: **not production-ready** —
see §0.

Each item states the risk, the current mitigation and what remains open. Severity
is about the impact on a real school pilot, not about implementation effort.

---

## 0. Production-readiness statement

The system is **a verified prototype on free-tier infrastructure**. It is **not**
production-ready for emergency use: responder notification is manual, backup
restore has not been rehearsed, no browser-level or device-level test pass has been
run, and the deployment still points at a development Supabase project with
synthetic data. The Phase 9 checklist in `docs/DEPLOYMENT.md` §6 is the gate for
that transition, and the responsible school authority must sign it off.

## 1. High severity

| # | Risk | Impact | Mitigation | Open action |
|---|---|---|---|---|
| H1 | **No external notification for responders** — a raised SOS is visible only when someone opens the app | Response time depends on someone polling; in a real emergency this is the single biggest gap | `/alerts` shows new-case notices to responders; the manual fallback (`docs/MANUAL_FALLBACK.md`) covers the gap; responders are told to check the queue | Decide on an external channel — only after its cost, privacy, secret storage and delivery semantics are reviewed (guide, Phase 7). No SMS/email/push exists today |
| H2 | **Cloudflare API token was pasted into a chat transcript** | Anyone with the transcript could deploy to the account | Token is only needed for deploys; the account is otherwise unmodified | **Rotate the token** (Dashboard → My Profile → API Tokens) and keep the replacement out of chat and out of the repo |
| H3 | **Cloudflare 2FA is disabled** (`enforce_twofactor = false`) | Account takeover via a stolen password | None currently | Enable 2FA on Cloudflare, Supabase and the GitHub repository |
| H4 | **Open sign-ups with a rate-limited mailer** | Anyone with the app URL can create an account in the school; real users may never receive a confirmation email | Accounts used for testing are pre-provisioned | Set `disable_signup = true` and provision accounts by the administrator, or add a custom SMTP provider, before any real user is onboarded |
| H5 | **Backup/restore has not been rehearsed** | Undetected data loss; the rollback path is untested in anger | Every migration has inverse SQL in `docs/ROLLBACK.md`; a previous build can be re-promoted on Cloudflare Pages | Perform a restore rehearsal (or a documented "restore into a scratch project" test) before the pilot; confirm what point-in-time recovery the Supabase plan actually offers |
| H6 | **Weather coordinates are placeholders (0.0000, 0.0000)** | The advisory describes the wrong place, and a placeholder could be mistaken for real | The advisory is labelled "placeholder coordinates — not the school's real location" in the API response and the UI | Set `LATITUDE`/`LONGITUDE`/`LOCATION_LABEL` in `worker/wrangler.toml` and redeploy the worker |
| H7 | **The deployment targets a development Supabase project** | Test accounts and synthetic data are the ones a real school would use | Only synthetic data exists; the runbook documents creating a separate project for the pilot | Provision a dedicated Supabase project (and its own auth redirect list) for the pilot |

## 2. Medium severity

| # | Risk | Impact | Mitigation | Open action |
|---|---|---|---|---|
| M1 | **No browser-level or end-to-end tests** | UI regressions in flows that only unit tests cannot see | 170 unit/component tests and 208 API-level RLS checks | Add Playwright e2e for the critical path (sign in → SOS → acknowledge → resolve → report → review) |
| M2 | **Accessibility verified at source level only** | A real screen-reader or device user may hit barriers the static checks cannot see | `npm run check:a11y` (labels, landmarks, contrast ≥ 4.5:1, 44 px targets, focus, reduced motion) passes on 30 source files | Run a screen-reader pass (NVDA/VoiceOver) and a real-phone pass with the school's actual devices |
| M3 | **No retention or anonymisation jobs** | Check-ins (90 days) and reports (1 year) accumulate personal data indefinitely | Retention targets are documented in `docs/ARCHITECTURE.md` §8.2 | Implement and schedule the jobs deliberately — deleting personal data on a schedule is a decision the school must make, not a default |
| M4 | **Per-building scope is missing** | Responders and teachers see school-wide data they may not need | Report and alert reads are role-scoped; the read scope is enforced in RLS, not in the UI | Model building scope before a multi-building school is onboarded |
| M5 | **Responders can read every check-in**, including "safe" ones with a location and source | More personal data than the response task strictly needs | Only reviewers (responder/administrator) can read check-ins | Narrow the read policy to "needs help" plus aggregated counts if the school asks |
| M6 | **No monitoring, error tracking or uptime alerting** | A broken deployment or a failing worker is noticed only when a human reports it | Worker failures return an explicit "weather unavailable"; the app surfaces errors | Add error reporting and a simple uptime check before the pilot |
| M7 | **Free-tier quotas are unmonitored** | Supabase (database, storage, auth, mail), Cloudflare Pages (builds) and Open-Meteo all have limits | Usage is small for one school | Record the current limits and set a review point; a busy school could hit them |
| M8 | **Single 500 kB JavaScript bundle** (no route code-splitting) | Slower first load on a weak mobile network — a realistic school condition | The bundle is gzip-compressed and cached immutably | Code-split the routes and load the heavy admin screens on demand |
| M9 | **Duplicate incident guard is a 5-minute window** | A genuine second emergency within 5 minutes is rejected | The error names the open case, and the case can be cancelled or resolved first; the manual fallback remains | Reconsider the window with the school (it is a policy decision) |
| M10 | **The verification harness mutates the database** (roles, test rows, notifications) | Running it against a production project would pollute real data and reset roles | The harness resets only the two synthetic test accounts and re-activates school categories | Never point the harness at a production project; run it only against a dev project |
| M11 | **Case references are a single global per-year sequence** | Numbers are not per-school | Fine for a single-school pilot | Make the sequence per school if multi-school deployment is planned |
| M12 | **Incident, alert and report corrections create new versions rather than editing** | A published correction is only visible after a second approval | The old version is retained and marked corrected — deliberate, and it preserves the record | None; documented behaviour |

## 3. Low severity

| # | Risk | Mitigation / note |
|---|---|---|
| L1 | Report/alert/injury categories and severities are hardcoded, not school-configurable | Location categories are already data-driven; the same pattern can be applied later |
| L2 | The *More* menu repeats some Home links | Cosmetic; the bottom nav carries the primary actions |
| L3 | No dark mode, no localisation | Not required for the pilot; would need a design pass |
| L4 | The weather advisory is current conditions only, no forecast | A forecast needs a second worker route and a cache strategy |
| L5 | The `Location (optional)` picker grows large in a big school | No search; acceptable at pilot scale, would need type-ahead |
| L6 | `is_stale` on stored observations is computed at write time, not at read time | The UI recomputes staleness from `observed_at` at render, so a stored row that ages is still shown correctly as stale |

## 4. What was checked in this phase (Phase 8)

| Area | Result |
|---|---|
| RLS and direct API access per role | 208/208 API checks, including a per-table anon sweep and student write/mutation denial on 11 and 7 tables respectively |
| Session and authorization behaviour | Tampered token → 401; no session → no rows |
| Input validation | Oversized text and invalid enum values rejected by the database |
| Upload restrictions | Non-public objects (400), disallowed MIME type rejected, over-size upload rejected |
| Secret hygiene | No `service_role` key or service-role variable in the built browser bundle |
| Accessibility (source level) | `npm run check:a11y` — labels, single `<main>` landmark, contrast ratios, focus, 44 px targets, reduced motion, responsive breakpoints, image alt text |
| Stale external data | Weather staleness measured from `observed_at`; missing data shown explicitly; stored fallback shown with its age |
| Mobile layout | Breakpoints exist at 48 rem and 75 rem, bottom navigation is fixed with a safe-area inset, and content is padded so the navigation cannot cover it — **not yet verified on a physical device** |
| Backup and restore | Inverse SQL recorded for all 17 migrations; a previous deployment can be re-promoted; **restore not rehearsed** (H5) |
| Audit history | Append-only, exposed to administrators at `/admin/audit`; role changes, location changes, incident transitions, alert workflow and case creation are all recorded |
