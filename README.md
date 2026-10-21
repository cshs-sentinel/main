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
| `npm run build` | production build to `dist/` |
| `node scripts/verify-rls.mjs` | RLS verification against the dev Supabase project |

`.env` holds only publishable (`VITE_`) keys. `SUPABASE_ACCESS_TOKEN` is needed
only for the optional multi-school/cleanup checks in the verification script and
is never committed.

## Current state

Phases 1–3 complete (Gate 1, Gate 2 and Gate 3 approved). Phase 4 (SOS and
incident response) is implemented and externally verified — server-allocated case
references, role-checked status transitions, retained history, response notes and a
documented manual fallback (migrations 0001–0013). Gate 4 evidence is in
`docs/GATE4_EVIDENCE.md`. See `docs/DEVELOPMENT_LOG.md` for the per-task record.

## Documentation

- `docs/ARCHITECTURE.md` — living specification (roles, routes, schema, RLS, flows)
- `docs/ROLLBACK.md` — migration rollback SQL and recovery options
- `docs/DEVELOPMENT_LOG.md` — per-task log
- `docs/GATE2_EVIDENCE.md` — Gate 2 evidence pack
- `docs/GATE3_EVIDENCE.md` — Gate 3 evidence pack
- `docs/GATE4_EVIDENCE.md` — Gate 4 evidence pack
- `docs/MANUAL_FALLBACK.md` — manual fallback and response responsibilities
- `docs/FIRST_ADMIN.md` — first administrator provisioning
- `AGENTS.md` — project rules for contributors
- `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` — phased roadmap and approval gates
