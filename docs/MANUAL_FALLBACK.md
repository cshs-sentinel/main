# SENTINEL — Manual Fallback and Response Responsibilities

Applies when the app, the network, or Supabase is unavailable, and defines who is
responsible for what during an incident. Required by `AGENTS.md` §7 (Phase 4) and
`docs/ARCHITECTURE.md` §5.2.

> SENTINEL assists school response coordination. It does **not** replace emergency
> services, school leadership, or official decision-making. If anyone is in
> immediate danger, call the local emergency number first.

---

## 1. When to use the manual fallback

Use it when any of these are true:

- the app will not load, or sign-in fails;
- an SOS is raised but no acknowledgement appears within the school's agreed
  response time (define this locally — e.g. 5 minutes);
- the network is down, or the device has no connectivity;
- the responder queue appears empty while staff report an emergency in progress
  (a case may not have reached the database).

## 2. Manual procedure

1. **Call emergency services first** for immediate danger (fire, medical
   emergency, violence). SENTINEL never replaces this call.
2. **Use the school's own alerting channel** (PA, radio, WhatsApp group, or the
   designated runner) to reach responders.
3. **Open a paper log** (see §3) and record: date/time, reporter name, case
   reference if known, location, nature of the incident, actions taken, and who
   responded.
4. **Assign a responder** verbally and record the assignment in the paper log.
5. **When the system is available again**, raise the case in SENTINEL:
   - the person who raised it enters the case on `/sos` and quotes the paper-log
     reference in the description;
   - the responder records the paper-log time in the first response note, e.g.
     *"Paper log ref PL-2026-03-01-004; acknowledged on radio at 11:42."*
6. **Reconcile**: the responder closes the case only after the paper log and the
   SENTINEL record agree on outcome. Keep the paper log with the school's
   incident records for the retention period in `docs/ARCHITECTURE.md` §8.2.

### Minimum paper log fields
`Ref | Date/time | Raised by | Location | Nature | Actions | Responder | Closed`

## 3. Known limitations of the fallback

- Case references issued on paper are **not** the same as SENTINEL case
  references; a case created later receives its own `SNT-YYYY-####` reference.
- Paper cases are not visible to the app until someone enters them, so the
  dashboard under-counts while the system is down.
- Duplicate suppression (one open case per person per 5 minutes) applies only to
  the app, not to the paper log.

---

## 4. Response responsibilities

| Role | Responsible for | In the system |
|---|---|---|
| Any person (student, teacher, staff) | Raise an SOS promptly; state location and nature; call emergency services for immediate danger; cancel a case they raised if it was a false alarm | `/sos` — raises a case, shows the case reference, allows cancelling own open case |
| Responder (safety officer) | Acknowledge promptly; take ownership (assign); work the case; record response notes; resolve with a short outcome; close the case; keep the paper log reconciled | `/incidents` — Acknowledge → Assign → Start → Resolve → Close, notes, timeline |
| Administrator | Ensure responders are rostered and reachable; cancel or close false alarms; oversee escalations; audit who did what; run the manual fallback when the system is down | `/admin/users`, `/incidents` (all responder powers), audit log |
| Teacher / staff | Direct students to evacuate or shelter; support the responder; use `/check-in` to record presence (self-report only) | `/check-in`, `/schedule` |
| Everyone | Never delete a case; never edit history — corrections are added as notes | No delete rights anywhere in the app |

### Escalation rules (school to confirm locally)

- **Immediate danger** → emergency services first, then SENTINEL.
- **No acknowledgement within the agreed time** → start the manual fallback (§2).
- **Case raised for the wrong school or a duplicate** → administrator cancels
  with a reason; the history is preserved.

### What the system does *not* do (by design)

- It does not notify responders by SMS, email or push (in-app alerting is a
  later phase). Responders must check the queue — the manual fallback in §2
  covers the gap.
- It does not verify that a case is real, that a person is safe, or that a
  location is occupied. A check-in or a schedule is never proof of presence.
- It does not close a case on its own; a human responder closes it.
