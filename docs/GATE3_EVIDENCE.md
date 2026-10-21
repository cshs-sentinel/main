# Gate 3 Evidence — Check-ins and hazard reports

Phase 3 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 3 = "Unauthorized users cannot read private reports or media."**

Status: **PASS** — external RLS verification **135/135** (sections 1–13, including a new
private-media section), local checks green (lint 0/0, typecheck ✓, 65 unit tests, build ✓).
Synthetic test data only — no real student data.

---

## 1. Unauthorized users cannot read private reports

| Concern | Evidence (verify-rls §11 → check) |
|---|---|
| Anon blocked | §11 anon blocked from `hazard_reports` — 0 rows |
| Report visible only to its author / reviewers | §11 *reporter can read own report*; *student cannot read another member's report*; *reviewer can read school reports*; *responder can read school reports* (after promotion) |
| Read scope enforced by role, not by UI | Policy `hazard_reports_select_school` (migration 0008) = `school_id = my_school_id() AND (reporter_id = auth.uid() OR is_reviewer())` — see `docs/ARCHITECTURE.md` §4.2 |
| Cross-school isolation | §11 *admin A cannot read school B reports*; *student A cannot read school B reports*; *cross-school report insert denied*; *report on other-school location rejected* |
| Write discipline | §11 *filing as another user rejected*; *non-reviewer status update blocked*; *student report delete blocked*; *admin report delete blocked — retained*; *report intact after delete attempts* |
| Workflow enforced server-side | §11 *direct open→resolved rejected*; *report details immutable after submission*; *pre-set status rejected* |
| Input validation | §11 *invalid category rejected*; *short description rejected*; *report on archived location rejected*; *cross-school report insert denied* |
| Audit | §11 *report changes audited* (create + update) |
| Check-in privacy (bonus scope) | §13 anon blocked; *check-in for another user denied*; *cross-school check-in denied*; *student cannot claim staff-verified location*; *check-in update/delete blocked* |

**Media (§12, private bucket `report-photos`):**

| Concern | Evidence |
|---|---|
| Bucket is private | §12 *report photo bucket is private* (`public=false`, 5 MB, JPEG/PNG/WebP only) |
| Anon cannot see media | §12 *anon blocked from report photos* — 0 objects |
| Only the author uploads to their own report | §12 *reporter uploads photo to own report*; *upload to another member's report denied*; *cross-school photo path denied* |
| Media readable only through the report's read scope | §12 *reporter can read own report photo*; *cannot read another member's report photo*; *reviewer can read school report photo* |
| Attachments cannot be forged | §12 *attachment for another member's report denied*; *attachment path mismatch rejected*; *reporter can register own attachment* |
| Deletion is scoped | §12 *photo delete by another member denied (object intact)*; *reporter can delete own photo* |
| No orphans | §12 *cleanup removed all test photos* — 0 remaining (orphans are purged through the Storage API; Supabase blocks direct SQL deletes on `storage.objects`) |

Signed URLs are short-lived (60 s) and requested by the client only after the
report read-scope check passes. Nothing in the bucket is publicly reachable.

## 2. Flow completeness (submission → authorized review)

`/reports` (any role) → file a report (category, description, optional location,
optional photo) → server validates and stores → `/admin/reports` (responder,
administrator) → Acknowledge → Resolve (or Reopen) → every step audited.
Unit tests: `src/features/reports/Reports.test.tsx` (6) and
`src/features/admin/AdminReports.test.tsx` (5).

## 3. Phase 3 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| One complete hazard-report flow: form validation → database persistence → authorized review | §11 (server validation) + `/reports` + `/admin/reports` + 11 unit tests |
| Safe error handling | Server messages surfaced verbatim in the UI (`role="alert"`); friendly server messages ("must be filed as yourself", "end time must be after start time"-style checks); photo upload failure keeps the filed report and reports the partial success |
| Access-control tests | §11–§13 (reports, media, check-ins) at the database/API layer, per role |
| Private-storage design proposed before implementation | Design documented in `docs/ARCHITECTURE.md` §4.2 ("Report photos") and implemented in migrations 0009–0011; bucket is non-public with signed-URL access |
| Report data and media not publicly accessible | RLS + storage policies + private bucket; anon blocked from both |
| No real student data | Synthetic records only (`RLS %` labelled, deleted per run); test users are `*-test.local` |
| Check-ins (Phase 3 scope) | Migration 0012 + `/check-in` + 6 unit tests + §13 |

## 4. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 65/65 (13 files) |
| `npm run build` | exit 0 |
| `node scripts/verify-rls.mjs` (token) | **135/135 passed**, sections 1–13 |

Migrations applied to the dev project (`vuqjfigoeuvjieznqyil`):
`0009_report_photos`, `00010_fix_attachment_filename`, `00011_report_photo_delete_scope`,
`00012_check_ins`. Inverse SQL for every one is recorded in `docs/ROLLBACK.md`.

## 5. Known limitations

- Report categories and check-in labels are hardcoded (v1) rather than school-configurable data.
- A filed report cannot be edited or withdrawn by its author (immutable record; reviewers close it out).
- Check-ins are a self-report log: `need_help` is a flag for responders, not an incident — the SOS/incident workflow is Phase 4.
- Photos are read via signed URLs; there is no in-app image viewer beyond opening the link, and no photo redaction UI.
- Deletion/retention jobs (90-day check-in anonymisation, 1-year report retention) are not implemented — a later phase.
- No e2e/browser tests; UI behaviour is covered by vitest + jsdom only.
- Check-in read scope for responders is school-wide, not per-building (building scope needs a scope model that does not exist yet).
- Verification runs were affected by intermittent network failures from the build machine to `*.supabase.co`; every failure observed was traced to connectivity, and the final run was clean.
