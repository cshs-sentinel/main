# Gate 4 Evidence — SOS and incident response

Phase 4 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 4 = "End-to-end test succeeds in a non-production environment; response
responsibilities are documented."**

Status: **PASS** — external verification **162/162** (sections 1–14, including the
new incident section, which runs the complete lifecycle against the non-production
dev project), local checks green, and the manual fallback / responsibilities are
documented in `docs/MANUAL_FALLBACK.md`.

---

## 1. End-to-end test in a non-production environment

`scripts/verify-rls.mjs` §14 runs the full case lifecycle against the **dev**
Supabase project (`vuqjfigoeuvjieznqyil`) as the real signed-in roles:

raise → acknowledge → assign → in_progress → resolve → close

| Step | Check | Result |
|---|---|---|
| Raise | *student raises an incident* | ✅ created |
| Reference | *case reference format SNT-YYYY-####* | ✅ `SNT-2026-0001` |
| Reference | *case references are unique* | ✅ per-year sequence |
| Duplicate | *duplicate incident within cooldown rejected* | ✅ quotes the open case reference |
| Acknowledge | *responder completes the full workflow* | ✅ acknowledge → assign → in_progress → resolve → close |
| Outcome | *incident reaches closed with resolution notes* | ✅ |
| History | *status history retained for every transition* | ✅ 5 rows for 5 transitions |
| Audit | *incident transitions audited* | ✅ `incident_transition` audit rows |
| Cancel | *creator can cancel their own case* | ✅ false alarm recorded with reason |
| Cancel | *cancellation keeps the reason and the history* | ✅ history preserved |
| Cleanup | *cleanup removed all test incidents* | ✅ 0 remaining |

## 2. Unauthorized transitions and role restrictions

| Concern | Evidence (verify-rls §14) |
|---|---|
| Only responders/admins move a case | *non-reviewer transition rejected* — `transition new -> acknowledged is not allowed for your role` |
| Only the creator (or an admin) cancels | *cannot cancel another member's incident* — same role-checked error |
| No bypass of the workflow | *direct status update blocked — RPC only* (even an administrator has no update policy) |
| No erasing of history | *incident delete blocked (0 rows)*; notes/history have no update or delete policy |
| Case visibility | *student cannot read another member's incident*; *student cannot read another member's incident history*; *cannot add a note to another member's incident* |
| School isolation | *cross-school incident insert denied* (RLS), location scoping enforced server-side |
| Anon | *anon blocked from incidents* — 0 rows |
| Counter secrecy | *case-reference counter not readable by clients* — `permission denied` |
| Input validation | *invalid incident category rejected*; description length and archive-location rules enforced in the trigger |

## 3. Response responsibilities documented

`docs/MANUAL_FALLBACK.md` covers:
- when to abandon the app (app down, sign-in broken, no acknowledgement within the
  school's agreed response time, queue empty while an emergency is in progress);
- the manual procedure (call emergency services first → school alerting channel →
  paper log with the minimum field set → verbal assignment → enter the case later
  with the paper reference → reconcile and close);
- the limitations of the fallback (paper references are not `SNT-` references, the
  dashboard under-counts while the system is down, duplicate suppression is
  app-only);
- the responsibility matrix (any person / responder / administrator / teacher) and
  escalation rules;
- what the system deliberately does not do (no SMS/email/push, no verification of
  presence, no automatic closure).

## 4. Phase 4 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| Create a case reference | `next_case_ref()` → `SNT-YYYY-####`, unique, server-allocated, counter not client-readable |
| Acknowledge, assign, update status, record notes, resolve, close | `transition_incident()` + `/incidents` UI (13 unit tests) |
| Retain history | `incident_status_history` append-only; no update/delete path exists |
| Duplicate protection where practical | 5-minute per-person open-case guard with a friendly message |
| Tests for unauthorized transitions | §14 role checks; `transition_incident` raises for any invalid transition or role |
| Tests for failed requests | Duplicate/category/description/location rejections asserted by message; UI surfaces server errors (`role="alert"`) |
| Document the manual fallback | `docs/MANUAL_FALLBACK.md` |
| Do not send real notifications or deploy | No SMS/email/push integration; nothing deployed; in-app responder notification is deferred to Phase 7 and the gap is documented in the fallback procedure |
| No real data | Synthetic records only (`RLS %`, deleted per run) |

## 5. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 78/78 (15 files) |
| `npm run build` | exit 0 |
| `node scripts/verify-rls.mjs` (token) | **162/162 passed**, sections 1–14 |

Migration `20261021000013_incidents.sql` applied to the dev project; inverse SQL in
`docs/ROLLBACK.md`.

## 6. Known limitations

- No in-app/notification delivery to responders: the queue must be checked (Phase 7); the manual fallback covers the gap.
- Assignment is always to the responder performing the transition — assigning to another responder is not implemented.
- Incident visibility is creator + responders/administrators; other staff of the same school cannot see an active case.
- `need_help` check-ins are not linked to incidents; a responder must open a case manually.
- Cancellation is only possible before resolution, and only by the creator or an administrator.
- No case attachments, no export, no incident analytics yet.
- No e2e/browser tests; the lifecycle is verified at the database/API layer and the UI is covered by vitest + jsdom.
- Verification runs were affected by intermittent network failures from the build machine to `*.supabase.co`; every failure observed was traced to connectivity, and the final run was clean.
