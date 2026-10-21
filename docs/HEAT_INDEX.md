# Heat Index — Formula, Units, Applicability and Rule Version

Required by `AGENTS.md` §7 (Phase 6) and `docs/ARCHITECTURE.md` §7.2.
Implementation: `src/features/weather/heatIndex.ts` (pure module, separately tested).
Tests: `src/features/weather/heatIndex.test.ts` (42 cases, including the NOAA reference table).

> **External weather data are not indoor classroom measurements.** The heat index
> describes how hot it *feels* outdoors in shade for a resting person. It ignores
> wind, direct sun, clothing, activity and every indoor factor (ventilation,
> air-conditioning, machinery, body heat of a full classroom). It is an
> **advisory only** and must never trigger an automatic class suspension, an
> automatic alert publication, or any other official decision.

---

## 1. Formula

The NOAA / National Weather Service **Rothfusun (Rothfusz) regression**, which
reproduces the NOAA heat index table to within about ±1.3 °F (0.7 °C):

```
HI(F) = c1 + c2·T + c3·R + c4·T·R + c5·T² + c6·R² + c7·T²·R + c8·T·R² + c9·T²·R²

c1 = −42.379
c2 =  2.04901523
c3 = 10.14333127
c4 = −0.22475541
c5 = −0.00683783
c6 = −0.05481717
c7 =  0.00122874
c8 =  0.00085282
c9 = −0.00000199
```

- `T` = ambient **dry-bulb** temperature in **degrees Fahrenheit**
- `R` = **relative humidity** in percent (0–100)
- `HI` = heat index in degrees Fahrenheit

The module accepts **Celsius** and converts internally
(`F = C·9/5 + 32`, `C = (F − 32)·5/9`); the published Celsius coefficient set is
equivalent and is recorded here for reference only.

### Low-humidity branch (RH < 40 %)

The heat index is not defined below 40 % relative humidity, so the module falls
back to the NWS "simple" formula and marks the result **not applicable**:

```
simple(F) = 0.5 · ( T + 61 + ((T − 68) · 1.2) + (R · 0.094) )
```

For air temperatures below 80 °F the simple value is averaged with the air
temperature. Results from this branch are labelled `method: "simple"`,
`applicable: false` and are advisory only.

## 2. Units

| Quantity | Unit |
|---|---|
| Air temperature (input) | degrees Celsius (converted to °F internally) |
| Relative humidity (input) | percent, 0–100 |
| Heat index (output) | degrees Celsius (converted from °F) |
| Timestamps | ISO 8601 UTC |

## 3. Valid input ranges and applicability

| Rule | Value |
|---|---|
| Accepted air temperature | −50 °C … +60 °C |
| Accepted relative humidity | 0 % … 100 % |
| Heat index **applicable** only when | T ≥ 26.7 °C (80 °F) **and** RH ≥ 40 % |
| Below 40 % RH | `method: "simple"`, `applicable: false` (advisory only) |
| Below 26.7 °C | `valueC: null`, `applicable: false` — use the air temperature |
| Non-finite or out-of-range input | `inputValid: false`, `valueC: null` (never throws) |

## 4. Advisory bands (NOAA heat index effects table)

| Heat index (°C) | Band | Effect |
|---|---|---|
| < 27 | none | — |
| 27 – 32 | caution | fatigue possible with prolonged exposure and activity |
| 32 – 41 | extreme caution | heat cramps and heat exhaustion possible; heat stroke possible |
| 41 – 54 | danger | heat cramps and heat exhaustion likely; heat stroke probable with continued activity |
| > 54 | extreme danger | heat stroke is imminent |

Bands are **advisory context for a human decision**, never an automatic action.

## 5. Data source, timestamp, freshness, rule version

Every advisory carries its provenance (see the worker response shape):

| Field | Meaning |
|---|---|
| `source` | data provider (`open-meteo`) |
| `observed_at` | when the upstream provider measured the conditions |
| `fetched_at` | when the server retrieved the observation (ISO 8601 UTC) |
| `units` | `{ temperature: "celsius", humidity: "percent" }` |
| `latitude` / `longitude` | the fixed school coordinates used for the observation |
| `heat_index.rule_version` | `heat_index_v1` — the calculation rule that produced the value |
| `heat_index.method` | `rothfusz` \| `simple` \| `not-applicable` |
| `heat_index.applicable` | whether the value is a real heat index |
| `heat_index.band` | advisory band from §4 |
| `freshness.age_seconds` | age of the observation |
| `freshness.stale` | true when the observation is older than the freshness window |

**Freshness rule:** an observation older than **3600 s (1 hour)** is reported as
`stale: true` and the UI shows it as stale. When the upstream provider cannot be
reached, the server returns an explicit failure and the UI shows
*"Weather unavailable."* — it never shows an old value as if it were current.
Stored observations keep their original `fetched_at` and `rule_version` so a value
can always be traced back to the rule that produced it.

## 6. Rule version history

| Version | Change |
|---|---|
| `heat_index_v1` | Initial: NOAA/NWS Rothfusz regression, NWS simple formula for RH < 40 %, bands from the NOAA effects table, 1-hour freshness window. |

Any change to the formula, the applicability limits, the bands or the freshness
window requires a **new** rule version (`heat_index_v2`, …) — stored values keep
the version they were computed with, and the version is displayed with the value.

## 7. Separation of concerns

| Layer | Responsibility |
|---|---|
| Cloudflare Worker (`worker/index.ts`) | retrieve the observation, call the calculation module, stamp source/timestamp/freshness/rule version, store the observation, serve the advisory |
| `src/features/weather/heatIndex.ts` | pure calculation only — no I/O, no decisions, fully unit tested |
| `src/features/weather/WeatherAdvisory.tsx` | display the advisory, including missing/stale state and the disclaimer |

The worker and the browser use the **same** calculation module, so the value shown
in the app is the value the server computed (no second implementation to drift).
