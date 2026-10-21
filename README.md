# SENTINEL

MCSI-08 SENTINEL — Smart Emergency Network for Tracking Incidents, Notifications,
Evaluation, and Logistics. A mobile-first school safety and incident-coordination
web application.

The system supports school personnel; it does not replace emergency services,
school leadership, or official decision-making. A scheduled room is never proof of
anyone's actual location or occupancy.

## Stack

- Vite + React + TypeScript, React Router, oxlint, Vitest (+ jsdom)
- Supabase (Postgres, Auth, Row Level Security, private Storage)
- GitHub for source control; Cloudflare Pages is the intended (not yet active) host

## Getting started

```powershell
npm install
Copy-Item .env.example .env   # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest unit/component tests |
| `npm run check:a11y` | source-level accessibility / contrast / UI checks |
| `npm run build` | production build to `dist/` |
| `node scripts/verify-rls.mjs` | RLS verification against the dev Supabase project |

`.env` holds only publishable (`VITE_`) keys. `SUPABASE_ACCESS_TOKEN` is needed
only for the optional multi-school/cleanup checks in the verification script and
is never committed.

## Current state

Phases 1–7 complete (Gate 1–7 approved). Phase 8 (security, accessibility and
reliability review) is implemented: a per-role API security sweep, a source-level
accessibility gate (`npm run check:a11y`), an administrator audit-log view, and a
prioritised risk register (`docs/RISK_REGISTER.md`) that records the remaining
gaps instead of glossing over them. The system is **not production-ready** — see
the register and `docs/GATE8_EVIDENCE.md`.
See `docs/DEVELOPMENT_LOG.md` for the per-task record.

## Documentation

- `docs/ARCHITECTURE.md` — living specification (roles, routes, schema, RLS, flows)
- `docs/ROLLBACK.md` — migration rollback SQL and recovery options
- `docs/DEVELOPMENT_LOG.md` — per-task log
- `docs/GATE2_EVIDENCE.md` — Gate 2 evidence pack
- `docs/GATE3_EVIDENCE.md` — Gate 3 evidence pack
- `docs/GATE4_EVIDENCE.md` — Gate 4 evidence pack
- `docs/GATE5_EVIDENCE.md` — Gate 5 evidence pack
- `docs/GATE6_EVIDENCE.md` — Gate 6 evidence pack
- `docs/GATE7_EVIDENCE.md` — Gate 7 evidence pack
- `docs/GATE8_EVIDENCE.md` — Gate 8 evidence pack
- `docs/RISK_REGISTER.md` — prioritised risk and defect list with mitigations
- `docs/HEAT_INDEX.md` — heat index formula, units, applicability and rule version
- `docs/MANUAL_FALLBACK.md` — manual fallback and response responsibilities
- `docs/FIRST_ADMIN.md` — first administrator provisioning
- `AGENTS.md` — project rules for contributors
- `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` — phased roadmap and approval gates
