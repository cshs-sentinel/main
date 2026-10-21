/**
 * SENTINEL heat index calculation module (Phase 6).
 *
 * Pure, dependency-free and separately testable: this module never fetches data
 * and never makes decisions. It only turns a dry-bulb temperature and a relative
 * humidity into an advisory value.
 *
 * Formula: the NOAA / NWS Rothfusun (Rothfusz) regression for the heat index,
 *   HI(F) = c1 + c2*T + c3*R + c4*T*R + c5*T^2 + c6*R^2 + c7*T^2*R
 *                + c8*T*R^2 + c9*T^2*R^2
 * with T in degrees Fahrenheit and R = relative humidity in percent.
 * The regression reproduces the NOAA heat index table to within about +/-1.3 F
 * (0.7 C) for T >= 80 F (26.7 C) and R >= 40%.
 *
 * Applicability (documented in docs/HEAT_INDEX.md):
 *   - The heat index is only defined for dry-bulb temperatures of 26.7 C (80 F)
 *     and above with relative humidity of 40% and above. Outside that range the
 *     result is reported as NOT APPLICABLE (or advisory only) and must never be
 *     presented as an official decision.
 *   - The heat index describes the sensation in shade for a resting person. It
 *     ignores wind, sun and activity, and it is NOT an indoor measurement.
 */

export const HEAT_INDEX_RULE_VERSION = 'heat_index_v1'

/** Dry-bulb temperature at and above which the heat index is defined (26.7 C / 80 F). */
export const HEAT_INDEX_MIN_TEMP_C = 26.7

/** Relative humidity at and above which the Rothfusz regression applies. */
export const HEAT_INDEX_MIN_RH = 40

/** Accepted input range for dry-bulb temperature, in degrees Celsius. */
export const VALID_TEMP_RANGE_C = { min: -50, max: 60 } as const

/** Accepted input range for relative humidity, in percent. */
export const VALID_RH_RANGE = { min: 0, max: 100 } as const

/** An observation older than this is reported as stale. */
export const STALE_AFTER_SECONDS = 3600

export type HeatIndexMethod = 'rothfusz' | 'simple' | 'not-applicable'

export type HeatIndexBand =
  | 'none'
  | 'caution'
  | 'extreme_caution'
  | 'danger'
  | 'extreme_danger'

export interface HeatIndexResult {
  /** Heat index in degrees Celsius, or null when the heat index does not apply. */
  valueC: number | null
  /** Air temperature that was used, in degrees Celsius. */
  airTempC: number
  /** Relative humidity that was used, in percent. */
  humidityPercent: number
  /** Which branch of the algorithm produced the value. */
  method: HeatIndexMethod
  /** True only when the value is a real heat index (T >= 26.7 C and RH >= 40%). */
  applicable: boolean
  /** Advisory band taken from the NOAA heat index effects table. */
  band: HeatIndexBand
  /** Version of the calculation rule, stored with every advisory. */
  ruleVersion: string
  /** Human-readable explanation, always populated. */
  notes: string
  /** False when the inputs were rejected; `valueC` is then null. */
  inputValid: boolean
}

const C1 = -42.379
const C2 = 2.04901523
const C3 = 10.14333127
const C4 = -0.22475541
const C5 = -0.00683783
const C6 = -0.05481717
const C7 = 0.00122874
const C8 = 0.00085282
const C9 = -0.00000199

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9
}

/** The NOAA/Rothfusz regression, in degrees Fahrenheit. */
export function rothfuszHeatIndexF(tempF: number, humidityPercent: number): number {
  const t = tempF
  const r = humidityPercent
  return (
    C1 +
    C2 * t +
    C3 * r +
    C4 * t * r +
    C5 * t * t +
    C6 * r * r +
    C7 * t * t * r +
    C8 * t * r * r +
    C9 * t * t * r * r
  )
}

/**
 * The NWS "simple" formula, in degrees Fahrenheit. It is used only for the
 * low-humidity branch, where the heat index is not defined; the result is
 * advisory and is flagged as not applicable.
 */
export function simpleHeatIndexF(tempF: number, humidityPercent: number): number {
  return 0.5 * (tempF + 61 + ((tempF - 68) * 1.2) + humidityPercent * 0.094)
}

/** Advisory band from the NOAA heat index effects table (degrees Celsius). */
export function bandForHeatIndexC(valueC: number | null): HeatIndexBand {
  if (valueC === null) return 'none'
  if (valueC > 54) return 'extreme_danger'
  if (valueC >= 41) return 'danger'
  if (valueC >= 32) return 'extreme_caution'
  if (valueC >= 27) return 'caution'
  return 'none'
}

/**
 * Compute the heat index for a dry-bulb temperature (C) and relative humidity (%).
 * Never throws: invalid input returns a result with `inputValid: false`.
 */
export function computeHeatIndex(tempC: number, humidityPercent: number): HeatIndexResult {
  const base = {
    airTempC: tempC,
    humidityPercent,
    ruleVersion: HEAT_INDEX_RULE_VERSION,
  }

  if (
    !Number.isFinite(tempC) ||
    !Number.isFinite(humidityPercent) ||
    tempC < VALID_TEMP_RANGE_C.min ||
    tempC > VALID_TEMP_RANGE_C.max ||
    humidityPercent < VALID_RH_RANGE.min ||
    humidityPercent > VALID_RH_RANGE.max
  ) {
    return {
      ...base,
      valueC: null,
      method: 'not-applicable',
      applicable: false,
      band: 'none',
      inputValid: false,
      notes:
        `Input out of range: expected temperature ${VALID_TEMP_RANGE_C.min}..${VALID_TEMP_RANGE_C.max} C ` +
        `and humidity ${VALID_RH_RANGE.min}..${VALID_RH_RANGE.max}%.`,
    }
  }

  const tempF = celsiusToFahrenheit(tempC)

  if (tempF >= 80 && humidityPercent >= HEAT_INDEX_MIN_RH) {
    const valueF = rothfuszHeatIndexF(tempF, humidityPercent)
    const valueC = fahrenheitToCelsius(valueF)
    return {
      ...base,
      valueC,
      method: 'rothfusz',
      applicable: true,
      band: bandForHeatIndexC(valueC),
      inputValid: true,
      notes:
        'NOAA/NWS heat index (Rothfusz regression). Describes apparent temperature in shade; ' +
        'not an indoor measurement and not a decision.',
    }
  }

  if (humidityPercent < HEAT_INDEX_MIN_RH) {
    const simpleF = simpleHeatIndexF(tempF, humidityPercent)
    const valueF = tempF < 80 ? 0.5 * (simpleF + tempF) : simpleF
    const valueC = fahrenheitToCelsius(valueF)
    return {
      ...base,
      valueC,
      method: 'simple',
      applicable: false,
      band: 'none',
      inputValid: true,
      notes:
        'Relative humidity below 40%: the heat index is not defined here. This advisory uses the ' +
        'NWS simple formula and must not be treated as a heat index.',
    }
  }

  return {
    ...base,
    valueC: null,
    method: 'not-applicable',
    applicable: false,
    band: 'none',
    inputValid: true,
    notes:
      'Air temperature below 27 C (80 F): the heat index does not apply. Use the air temperature.',
  }
}

/** True when an observation is older than the freshness window. */
export function isObservationStale(fetchedAt: string, nowMs: number = Date.now()): boolean {
  const timestamp = Date.parse(fetchedAt)
  if (Number.isNaN(timestamp)) return true
  return nowMs - timestamp > STALE_AFTER_SECONDS * 1000
}

/** Age of an observation in seconds, or null when the timestamp is unusable. */
export function observationAgeSeconds(
  fetchedAt: string,
  nowMs: number = Date.now(),
): number | null {
  const timestamp = Date.parse(fetchedAt)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.round((nowMs - timestamp) / 1000))
}
