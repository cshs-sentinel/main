# Gate 9 Evidence — Deployment and controlled pilot

Phase 9 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 9 = "Pilot checklist signed off by the responsible school authority."**

Status: **NOT YET PASSED — awaiting the school authority's sign-off.** Everything
that can be prepared and verified without the school has been done and is
recorded below; the gate itself requires a human decision that only the school can
make, and the seven open items in `docs/RISK_REGISTER.md` are still open.

---

## 1. What is deployed and verified right now

| Item | State | Evidence |
|---|---|---|
| Application | **Live** on Cloudflare Pages: `https://sentinel-app-1jo.pages.dev` | deployment `8e666f9d`; all routes 200; SPA deep links 200 |
| Staging environment | **Live**: `https://staging.sentinel-app-1jo.pages.dev` (branch `staging`) | deployment `0d04c330`; routes 200 |
| End-to-end journeys | **29/29 journey steps pass** against the live database with real sessions | `npm run check:journey` — check-in → report + photo → SOS → acknowledge → assign → resolve → close → alert publish, with the forbidden paths refused, history retained and the dashboard counts matching the records |
| Demo content | The app is seeded with a **synthetic** school (campus, 2 wings, 3 floors, 6 rooms, 30 timetable slots, 2 check-ins, 2 reports, 1 acknowledged case, 1 published alert) | `npm run seed:school` |
| Security headers | CSP, `nosniff`, `DENY` frames, referrer policy, permissions policy | `npm run check:pilot` (DEPLOY section) |
| Weather worker | **Live** at `https://sentinel-weather.sentinelcshs.workers.dev` | responds 200, correct CORS origin, `heat_index_v1`, "not an indoor measurement" disclaimer present |
| Database | Dev project `vuqjfigoeuvjieznqyil`, 17 migrations applied | `node scripts/verify-rls.mjs` → **208/208** checks pass |
| Access control | Per-table, per-role, verified at the API layer | 208 checks across 18 sections, including a per-table anon sweep |
| Build | 170/170 unit tests, lint 0/0, typecheck ✓, a11y checks ✓, production build ✓ | `npm run lint / typecheck / test / build / check:a11y / check:pilot` |
| Rollback path | **Rehearsed for real** | see §2 |
| Documentation | 16 documents, every migration has a documented rollback | `npm run check:pilot` (DOCS section) |
| Pilot readiness | **39/39 automated checks pass** | `npm run check:pilot` |

## 2. Backup / restore rehearsal (was risk H5)

The documented inverse SQL for migration `0012` (check-ins) was **executed**, not
simulated:

1. state before: table present;
2. applied the inverse SQL from `docs/ROLLBACK.md` → **table dropped**;
3. re-applied `20261021000012_check_ins.sql` from the repository → **table
   restored** with both policies and the validation trigger;
4. the full verification suite re-ran afterwards: **208/208 pass**.

What this proves: the migration files, the documented rollback SQL and the
re-apply path are consistent and work in anger.

What it does **not** prove: a full point-in-time recovery of the managed project.
The free plan does not include PITR, and a real restore drill (restore into a
scratch project and compare) is still outstanding.

## 3. Phase 9 pre-flight checklist state

`docs/DEPLOYMENT.md` §6 is the checklist. Current state:

| Checklist item | State |
|---|---|
| Staging hostname, smoke test of the main flows | ✅ deployed and smoke-tested (sign in, report, SOS, acknowledge/close, schedule, photo upload, alerts) |
| `verify-rls` still 208/208 | ✅ |
| Supabase auth redirect URL and site URL point at the deployed origin | ✅ done |
| Service-role and weather keys only as Worker secrets | ✅ verified — no privileged key in the built bundle |
| Security headers present | ✅ verified by `npm run check:pilot` |
| Backup/restore rehearsal | ⚠️ migration rollback rehearsed; full PITR restore still outstanding (H5) |
| Manual fallback briefed to staff | ⚠️ **documented** (`docs/MANUAL_FALLBACK.md`), **not yet briefed** |
| Response responsibilities assigned to named people | ⚠️ **documented**, **not yet assigned** |
| Synthetic data confirmed, no real records | ✅ |
| Free-tier quotas checked | ⚠️ quotas recorded; **a free Supabase project pauses after a week of inactivity** — needs an operational decision for the pilot |
| Dedicated pilot Supabase project | ❌ **not created** — the available management token returns 403 on project creation; the account owner must create it (steps in `docs/DEPLOYMENT.md` §5.1) |
| Custom domain | ❌ needs a domain the school owns |
| Signed off by the responsible school authority | ❌ **the gate itself** |

## 4. Open risks that block a pilot (from `docs/RISK_REGISTER.md`)

| # | Risk | Owner action |
|---|---|---|
| H1 | Responders are not notified externally — the queue must be polled | Decide on a channel after a cost/privacy/delivery review, or accept the manual fallback as the operating assumption |
| H2 | Cloudflare API token was pasted into a chat transcript | Rotate it |
| H3 | Cloudflare 2FA disabled | Enable 2FA on Cloudflare, Supabase, GitHub |
| H4 | Open sign-ups + rate-limited mailer | `disable_signup = true` + pre-provisioned accounts (or a custom SMTP provider) |
| H5 | Full PITR restore not rehearsed | Rehearse a restore, or accept the documented migration rollback as the recovery path |
| H6 | Weather coordinates are placeholders | Set the school's real coordinates and redeploy the worker |
| H7 | Deployment points at the development Supabase project | Create the pilot project (§5.1) and repoint the build variables |

## 5. What the assistant cannot do

- Create a Supabase project (403 with the available token) — **owner action**.
- Register a domain or manage DNS — **owner action**.
- Enable 2FA for the account — **owner action**.
- Sign the pilot checklist off — **the school authority's decision**, and it must
  be a person, not a tool.

## 6. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 170/170 (23 files) |
| `npm run build` | exit 0 |
| `npm run check:a11y` | passed (30 source files) |
| `npm run check:pilot` | **39/39** automated checks pass |
| `node scripts/verify-rls.mjs` (token) | **208/208** passed, sections 1–18 |
| rollback rehearsal (0012) | **PASSED** — dropped, re-applied, verified |

## 7. Known limitations of this evidence

- The automated checks cover what can be checked from outside; they do not replace a
  browser pass, a screen-reader pass, a real-device pass or a load test (all still
  listed in `docs/RISK_REGISTER.md` as M1, M2, M7).
- The smoke test was performed against synthetic accounts; no real staff or student
  has used the system.
- The pilot readiness script checks the *current* deployment; it must be re-run
  after any change of project, domain or build variables.
