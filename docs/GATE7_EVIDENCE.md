# Gate 7 Evidence — In-app alerts

Phase 7 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 7 = "Only authorized approvers can publish; correction/cancellation and failed
delivery are handled."**

Status: **PASS** — external verification **197/197** (sections 1–17, including the new
alerts section), **164/164** unit tests, lint 0/0, typecheck ✓, build ✓.

> No external channel (SMS, email, push) is integrated. Nothing in the product
> claims an alert was "delivered" — an alert is **published in the app**, and the UI
> says exactly that. Per the guide, an external channel is only considered after
> its cost, privacy, secret storage and delivery semantics are reviewed and
> approved; that review has not been done, so none is integrated.

---

## 1. Only authorized approvers can publish

| Concern | Evidence (verify-rls §17) |
|---|---|
| Only administrators may approve/publish/correct/cancel | *non-approver cannot publish* — `only administrators may publish alerts` |
| A draft is not publishable without approval | *publishing before approval rejected* — `an alert must be approved before it can be published` |
| Students cannot even draft | *student cannot draft an alert* (RLS: responders/administrators only) |
| Clients cannot set a status directly | *non-author cannot update an alert (0 rows)*; *even the author cannot set the status directly (0 rows)* — the `validate_alert` trigger rejects any status change that does not come from the workflow functions |
| No client delete | *client cannot delete an alert (0 rows)* — published alerts, corrections and cancellations are retained |
| Published alerts reach the audience | *published alert visible to students* (scope `all`); *student cannot read a responders-only alert*; *reviewer can read a responders-only alert* |
| Anon | *anon blocked from alerts*, *anon blocked from case notifications* |

Server-side functions (all `security definer`, `revoke … from public`, granted to
`authenticated` only): `approve_alert`, `publish_alert`, `correct_alert`,
`cancel_alert`. The workflow functions set a transaction-local flag that the
validation trigger honours — clients can never set a status themselves.

## 2. Correction and cancellation are handled

| Concern | Evidence |
|---|---|
| A correction creates a new version | *correction creates a new version* (`version = 2`) |
| The superseded row is retained and marked | *superseded alert is retained and marked corrected* (`status = corrected`) |
| A correction must itself be approved and published | the new row is created as a **draft** (server-side, in `correct_alert`) and therefore goes through approval again |
| Cancellation keeps the record and the reason | *administrator cancels the alert*; *cancelled alert is retained with a reason* |
| The whole workflow is audited | *alert workflow is audited* — `alert_approved`, `alert_published`, `alert_corrected`, `alert_cancelled` rows in `audit_logs` |

## 3. Failed delivery is handled by not pretending to deliver

There is no external delivery, so there is no delivery status to misreport:

- the publish confirmation says *"Published … in the app. **No SMS or email was sent.**"*;
- the alerts page states *"Alerts are published in the app only — no SMS, email or push
  message is sent."*;
- the dashboard repeats it;
- the database comment on `alerts` records the same rule.

If an external channel is added later, it must be a separate, reviewed task, and the
UI may only say "delivered" when the provider confirms it.

## 4. Responders are told about new cases (§6.2)

A new incident automatically creates an **operational** notification
(`incident_notifications`), visible to responders and administrators only:

- *new case creates a reviewer notification*;
- *students cannot read case notifications*;
- it is clearly separated from official announcements in the UI ("New cases" vs
  "Official alerts", with the note *"These are not official announcements"*), so an
  automatic system row can never be mistaken for an approved announcement.

## 5. Phase 7 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| Start with in-app alerts | `/alerts` feed + `/admin/alerts` console, in-app only |
| Draft, preview, approval, publication, correction, cancellation, audit history | all implemented and verified (see §1–§2) |
| Enforce publisher permissions server-side | `is_admin()` inside the workflow functions; RLS blocks client status writes; the trigger blocks any other path |
| Do not integrate paid SMS/push/email until cost/privacy/secret storage/delivery behaviour is reviewed and approved | **no external channel integrated**; the UI never claims delivery; the review is listed as an open decision |
| Never label an alert as delivered without provider confirmation | the product only uses the word "published", always with the explicit "no SMS or email was sent" note |

## 6. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 164/164 (22 files) |
| `npm run build` | exit 0 |
| `node scripts/verify-rls.mjs` (token) | **197/197 passed**, sections 1–17 |

Migrations `20261021000016_alerts.sql` and `20261021000017_alert_workflow_flag.sql`
applied to the dev project; inverse SQL in `docs/ROLLBACK.md`.

## 7. Known limitations

- **The publisher is the administrator** in v1; the original design's "approver" flag per person is not implemented (it would need a profile attribute and an admin screen). A responder can draft but cannot publish.
- Audience targeting supports *everyone*, *one role* and *responders*; **per-building targeting is not implemented** (it needs a building-scope model that does not exist yet), and the original `alert_targets` table was deferred for that reason.
- No in-app notification badge, no push, no email, no SMS — the responder still has to open the app (or `/alerts`) to see a new case.
- No alert expiry, scheduling or end-date; a published alert stays published until cancelled or corrected.
- No read receipts (who has seen an alert).
- A correction creates a **new draft** that must be approved and published again — the published text changes only after that second approval, which is deliberate but means a correction is not instantly visible.
- `window.prompt` is not used; cancellation takes an explicit reason field.
- The verification harness now **self-heals** the test state (admin/student roles and inactive school categories) because interrupted runs used to leave the accounts in a state that broke unrelated checks.
