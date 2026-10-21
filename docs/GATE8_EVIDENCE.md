# Gate 8 Evidence — Security, accessibility and reliability

Phase 8 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 8 = "No unresolved critical/high-risk issue is accepted silently. Record
limitations and mitigations."**

Status: **PASS with recorded open risks** — every high and medium risk is written
down in `docs/RISK_REGISTER.md` with its mitigation and the action still required.
**The system is explicitly NOT production-ready** (see §4).

---

## 1. What was tested

| Area | How | Result |
|---|---|---|
| RLS and direct API access for each role | `verify-rls.mjs` §18 sweep: anon read across **all 15 tables**, student write attempts on **11 protected tables**, student update/delete attempts on **7 tables** | ✅ 208/208 API checks pass |
| Session and authorization behaviour | tampered bearer token; request without a session | ✅ 401 / no rows |
| Input validation | oversized text (>2000 chars), invalid enum value | ✅ rejected by the database |
| Upload restrictions | public object URL, disallowed MIME type, over-size upload | ✅ 400 / rejected / rejected |
| Sensitive logs and secrets | the built bundle is scanned for `service_role` and service-role variables | ✅ none present |
| Stale external data | weather staleness measured from `observed_at`; missing data shown explicitly; stored fallback shown with its age | ✅ (worker unit test + UI test) |
| Accessibility (source level) | new `npm run check:a11y` (`scripts/check-a11y.mjs`): accessible names, one `<main id="main">` per page, positive-tabindex, focus styling, WCAG AA contrast of the design tokens, 44 px targets, `prefers-reduced-motion`, responsive breakpoints, image alt text | ✅ passes on 30 source files; 11 contrast pairs measured (lowest 4.63:1, AA needs 4.5:1) |
| Mobile layout | breakpoints at 48 rem / 75 rem, fixed bottom navigation with a safe-area inset, content padded so the navigation cannot cover it | ⚠️ source-level only — **not yet verified on a physical device** |
| Backups and restore | inverse SQL for all 17 migrations in `docs/ROLLBACK.md`; Cloudflare keeps previous builds for one-click rollback | ⚠️ **restore not rehearsed** (risk H5) |
| Audit history | `/admin/audit` (administrator only) shows the append-only log; role changes, location changes, incident transitions, alert workflow and case creation are recorded | ✅ implemented and tested |
| Unit and component tests | vitest + jsdom | ✅ 170/170 (23 files) |

The checker also **found and fixed real problems** during this phase: the auth pages
had no `<main id="main">` target for the skip link, the dashboard rendered two
`<main>` elements, and the contrast/label rules had not been enforced anywhere.

## 2. What was NOT tested (and therefore is not claimed)

- Real browser end-to-end runs (no Playwright) — **M1**.
- Screen-reader and real-device passes — **M2**.
- Backup restore rehearsal / point-in-time recovery — **H5**.
- Load and concurrency testing; the case-reference sequence under parallel writes is
  protected by a row lock but not load-tested.
- Penetration testing by an external party; the review here is an internal focused
  test and security review.
- Behaviour of the free tiers under real school-scale load — **M7**.

## 3. Open risks are recorded, not silently accepted

`docs/RISK_REGISTER.md` lists **7 high**, **12 medium** and **6 low** items, each
with impact, current mitigation and the action still required. The high-severity
items are:

| # | Risk | Required action |
|---|---|---|
| H1 | Responders are not notified externally — the queue must be polled | Decide on a channel after a cost/privacy/delivery review (no external channel is integrated today) |
| H2 | The Cloudflare API token was pasted into a chat transcript | **Rotate it** |
| H3 | Cloudflare 2FA is disabled | **Enable 2FA** (Cloudflare, Supabase, GitHub) |
| H4 | Open sign-ups with a rate-limited mailer | `disable_signup = true` + pre-provisioned accounts, or a custom SMTP provider |
| H5 | Backup restore has not been rehearsed | Rehearse before the pilot |
| H6 | Weather coordinates are placeholders | Set the school's real coordinates |
| H7 | The deployment points at the development Supabase project | Provision a dedicated project for the pilot |

None of these is accepted silently: each is written down with its mitigation and
owner action, and none of them was worked around in the code.

## 4. Production-readiness

Per the guide — *"Do not claim the system is production-ready if critical tests
remain unrun or unresolved"* — SENTINEL is **not** production-ready. It is a
verified prototype: every implemented workflow is enforced server-side and
externally verified, the accessibility floor is met by machine-checkable rules, and
the remaining gaps are enumerated above rather than glossed over. The Phase 9
checklist in `docs/DEPLOYMENT.md` §6 (including the signed-off pilot checklist) is
the gate for a real deployment, and the manual fallback in
`docs/MANUAL_FALLBACK.md` is the operating assumption until external notification
exists.

## 5. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 170/170 (23 files) |
| `npm run build` | exit 0 |
| `npm run check:a11y` | passed (30 source files, 11 contrast pairs) |
| `node scripts/verify-rls.mjs` (token) | **208/208 passed**, sections 1–18 |
| `npx vitest run worker` | 5/5 (worker handler with a mocked provider) |

## 6. Deliverables added in this phase

| File | Purpose |
|---|---|
| `scripts/check-a11y.mjs` (+ `npm run check:a11y`) | Source-level accessibility, contrast and UI-quality gate |
| `src/features/admin/AuditLog.tsx` + tests | The audit trail is now visible to administrators (it was previously written but never shown) |
| `docs/RISK_REGISTER.md` | Prioritised defect/risk list with mitigations and open actions |
| `docs/GATE8_EVIDENCE.md` | This evidence pack |
