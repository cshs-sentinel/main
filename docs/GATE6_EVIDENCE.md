# Gate 6 Evidence — Weather and computation

Phase 6 completion evidence per `SENTINEL_OPENCODE_VIBE_CODING_GUIDE.md` §6:
**Gate 6 = "Reference test cases pass; stale data and uncertainty are visible; no
automatic official decision is made."**

Status: **PASS** — external verification **175/175** (sections 1–16, including the new
weather section), **139/139** unit tests (42 heat-index reference and edge cases
against the NOAA reference table, 5 worker tests, 7 advisory UI tests), lint 0/0,
typecheck ✓, build ✓. The weather worker is **deployed and live** (see §7 for the
one pending redeploy after the staleness correction).

> **Correction (Task 6.5).** The worker and the UI originally measured staleness
> from the *fetch* timestamp, which is always current, so `freshness.stale` and the
> stored `is_stale` column could never be true and the live "STALE" marker could
> never appear. Both now measure the age of the **observation** (`observed_at`),
> which is what the freshness window is defined against. `worker/worker.test.ts`
> is the regression test; it fails against the previous implementation.

---

## 1. Reference test cases pass

`src/features/weather/heatIndex.ts` implements the **NOAA / NWS Rothfusun
regression**; `src/features/weather/heatIndex.test.ts` checks it against the **NOAA
heat index table** (25 reference pairs) with a ±1.5 °F tolerance, plus the source's
own worked example (96 °F / 65 % RH → 121 °F) and 17 further edge cases.

| Reference (from the NOAA table) | Expected | Verified |
|---|---|---|
| 80 °F / 40 % | 80 °F | ✅ |
| 80 °F / 100 % | 87 °F | ✅ |
| 90 °F / 40 % | 91 °F | ✅ |
| 90 °F / 70 % | 105 °F | ✅ |
| 90 °F / 100 % | 132 °F | ✅ |
| 96 °F / 65 % | 121 °F (the table's own example) | ✅ |
| 100 °F / 40 % | 109 °F | ✅ |
| 110 °F / 40 % | 136 °F | ✅ |

Edge cases covered: the applicability boundary (26.7 °C / 40 % RH), just below it,
below 40 % RH (simple formula, flagged not applicable), cool conditions (no value,
use air temperature), out-of-range humidity and temperature, non-finite input,
unit conversion round-trips, the NOAA advisory bands, the freshness window and the
rule version. The module never throws — invalid input returns
`inputValid: false`.

## 2. Stale data and uncertainty are visible

| Situation | Behaviour | Evidence |
|---|---|---|
| Live observation | Shows air temperature, humidity, heat index, band, source, `observed_at`, `fetched_at`, age in seconds and the rule version | `WeatherAdvisory.test.tsx` + live worker response |
| Observation older than the freshness window (1 h) | Flagged **STALE** in the API (`freshness.stale`) and in the stored row (`is_stale: true`), and rendered as **STALE** in the UI | `worker/worker.test.ts` (*flags an observation older than the freshness window as stale*), `heatIndex.test.ts` (freshness cases), `WeatherAdvisory.test.tsx` (*marks a live observation as stale*) |
| Upstream provider unreachable | The worker answers **502** with `available: false`; the UI shows *"weather unavailable"* and never an old value as if it were current | `WeatherAdvisory.test.tsx` (*reports an unavailable weather service explicitly*) |
| Service unreachable but a stored observation exists | The last stored reading is shown **with its age and a STALE marker** | `WeatherAdvisory.test.tsx` (*shows the last stored observation as stale*) |
| Heat index not applicable (T < 27 °C or RH < 40 %) | `value_c: null` or an advisory-only value, with the reason shown in the UI | worker response + UI notes |
| Placeholder coordinates | The advisory is labelled *"placeholder coordinates — not the school's real location"* | worker response `location_label` |
| Client cannot write observations | RLS denies insert/delete; only the server (service role) writes | §16 *client cannot write a weather observation*, *client cannot delete weather observations* |
| Server-side ingestion is attributed | Every stored row carries source, observed/fetched timestamps, units, `rule_version` and the calculation method | §16 *server-side observation stored with source and rule version* |

## 3. No automatic official decision is made

- The heat index is **displayed as an advisory** with the NOAA effects band
  (*caution / extreme caution / danger / extreme danger*) and never as a decision.
- The worker response carries the disclaimer: *"External weather data are not indoor
  classroom measurements. Advisory only — this does not automatically suspend classes
  or trigger any emergency action."* The UI repeats it on every advisory.
- No alert is published, no class is suspended, no case is created and no
  notification is sent by the weather module — it only produces a number with its
  provenance.
- The advisory is visible to **responders and administrators only** (per
  `docs/ARCHITECTURE.md` §7.1); students and teachers see the note *"Weather advisory
  — shown to responders and administrators only."*

## 4. Separation of retrieval and computation

| Layer | File | Responsibility |
|---|---|---|
| Retrieval | `worker/index.ts` | fetch the observation, call the calculation module, stamp source/timestamp/units/freshness/rule version, store the observation, serve the advisory |
| Computation | `src/features/weather/heatIndex.ts` | pure calculation — no I/O, no decisions, 42 unit tests |
| Presentation | `src/features/weather/WeatherAdvisory.tsx` | show the value, the provenance, and the missing/stale states |
| Worker tests | `worker/worker.test.ts` | exercise the deployed handler end to end with a mocked provider: fresh, stale, stored-row provenance, provider failure, not-applicable heat index |

The worker imports **the same module** the browser tests, so there is no second
implementation to drift. The worker's service-role key lives only as a Cloudflare
secret — it is never in the browser bundle and never in the repository.

## 5. Phase 6 prompt requirements → coverage

| Requirement | Coverage |
|---|---|
| Separate weather retrieval from the computational module | worker vs. `heatIndex.ts` (see §4) |
| Document formula, units, valid input ranges, applicability conditions, data source, timestamp, freshness rules, calculation-rule version | `docs/HEAT_INDEX.md` §1–§6 (and the response shape) |
| Unit tests for known reference cases and edge cases | 42 heat-index tests (25 NOAA reference pairs + 17 edge/boundary cases) |
| Show missing or stale data explicitly | see §2 |
| Do not treat external weather as indoor measurements | disclaimer in the API response, in the UI, in the docs and in the table comment |
| Do not make automatic class-suspension decisions | advisory only; no automated action exists (see §3) |
| Fetch weather server-side where possible | Cloudflare Worker, service-role secret server-side, browser never talks to the provider |

## 6. Commands run (outcomes)

| Command | Result |
|---|---|
| `npm run lint` | 0 warnings, 0 errors |
| `npm run typecheck` | exit 0 |
| `npm run test` | 139/139 (19 files) — 42 heat-index, 5 worker, 7 advisory UI, 85 pre-existing |
| `npm run build` | exit 0 |
| `node scripts/verify-rls.mjs` (token) | **175/175 passed**, sections 1–16 |
| `npx wrangler deploy --config worker/wrangler.toml` | worker live at `https://sentinel-weather.sentinelcshs.workers.dev` — **redeploy pending for the Task 6.5 staleness correction** |

Migration `20261021000015_weather_observations.sql` applied to the dev project;
inverse SQL in `docs/ROLLBACK.md`.

## 7. Known limitations

- **The deployed worker still carries the pre-correction staleness logic.** The Task 6.5 fix is committed but the worker has not been redeployed, so the live endpoint still reports `freshness.stale: false` unconditionally. The fix must be redeployed before the live "STALE" marker can be observed in production.
- **The coordinates are placeholders** (0.0000, 0.0000) — the advisory is labelled as such and must be set to the school's real coordinates (`worker/wrangler.toml` vars) before any pilot. Weather for the wrong place is worse than no weather.
- Only **current** conditions are ingested — no forecast, no hourly series, no multi-day outlook.
- The heat index ignores wind, direct sun, activity and every indoor factor; it is not a classroom temperature.
- The low-humidity branch uses the NWS simple formula **without** the NWS low-humidity adjustment table, and is explicitly marked as not a heat index.
- Observations are stored but not pruned (retention job is a later phase); the table grows one row per request.
- The worker has no cache: every request hits the provider (Open-Meteo is free and generous, but a cached value with a visible age would be kinder to the provider).
- No alert is raised from a heat index value — that belongs to Phase 7 and still needs human approval.
- Verification runs were affected by intermittent network failures from the build machine; every failure observed was traced to connectivity, and the final run was clean.
