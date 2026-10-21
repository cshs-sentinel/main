import { describe, expect, it } from 'vitest'
import {
  HEAT_INDEX_MIN_RH,
  HEAT_INDEX_MIN_TEMP_C,
  HEAT_INDEX_RULE_VERSION,
  STALE_AFTER_SECONDS,
  bandForHeatIndexC,
  celsiusToFahrenheit,
  computeHeatIndex,
  fahrenheitToCelsius,
  isObservationStale,
  observationAgeSeconds,
  rothfuszHeatIndexF,
} from './heatIndex'

/**
 * Reference values from the NOAA / National Weather Service heat index table
 * (reproduced in the "Heat index" article, Table of values). The Rothfusz
 * regression reproduces that table to within about +/-1.3 F (0.7 C).
 */
const NOAA_TABLE: { tempF: number; rh: number; hiF: number }[] = [
  { tempF: 80, rh: 40, hiF: 80 },
  { tempF: 80, rh: 60, hiF: 82 },
  { tempF: 80, rh: 80, hiF: 84 },
  { tempF: 80, rh: 100, hiF: 87 },
  { tempF: 82, rh: 45, hiF: 82 },
  { tempF: 84, rh: 60, hiF: 88 },
  { tempF: 86, rh: 40, hiF: 85 },
  { tempF: 86, rh: 90, hiF: 105 },
  { tempF: 88, rh: 50, hiF: 91 },
  { tempF: 90, rh: 40, hiF: 91 },
  { tempF: 90, rh: 50, hiF: 95 },
  { tempF: 90, rh: 55, hiF: 97 },
  { tempF: 90, rh: 60, hiF: 100 },
  { tempF: 90, rh: 65, hiF: 103 },
  { tempF: 90, rh: 70, hiF: 105 },
  { tempF: 90, rh: 80, hiF: 113 },
  { tempF: 90, rh: 90, hiF: 122 },
  { tempF: 90, rh: 100, hiF: 132 },
  { tempF: 90, rh: 95, hiF: 127 },
  // Explicitly stated in the NOAA source: 96 F and 65% RH -> 121 F.
  { tempF: 96, rh: 65, hiF: 121 },
  { tempF: 100, rh: 40, hiF: 109 },
  { tempF: 100, rh: 50, hiF: 118 },
  { tempF: 100, rh: 60, hiF: 129 },
  { tempF: 110, rh: 40, hiF: 136 },
]

describe('heat index — NOAA reference cases', () => {
  it.each(NOAA_TABLE)('reproduces the NOAA table for $tempF F and $rh% RH', ({ tempF, rh, hiF }) => {
    const result = computeHeatIndex(fahrenheitToCelsius(tempF), rh)
    expect(result.inputValid).toBe(true)
    expect(result.applicable).toBe(true)
    expect(result.method).toBe('rothfusz')
    const computedF = celsiusToFahrenheit(result.valueC as number)
    expect(Math.abs(computedF - hiF)).toBeLessThanOrEqual(1.5)
  })

  it('matches the NOAA example: 96 F and 65% RH is about 121 F (49 C)', () => {
    const result = computeHeatIndex(fahrenheitToCelsius(96), 65)
    expect(result.valueC).not.toBeNull()
    expect(celsiusToFahrenheit(result.valueC as number)).toBeGreaterThanOrEqual(119.5)
    expect(celsiusToFahrenheit(result.valueC as number)).toBeLessThanOrEqual(122.5)
    expect(result.band).toBe('danger')
  })
})

describe('heat index — unit conversions', () => {
  it('converts between Celsius and Fahrenheit', () => {
    expect(celsiusToFahrenheit(0)).toBeCloseTo(32, 6)
    expect(celsiusToFahrenheit(100)).toBeCloseTo(212, 6)
    expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 6)
    expect(fahrenheitToCelsius(celsiusToFahrenheit(23.5))).toBeCloseTo(23.5, 6)
  })

  it('computes the regression in Fahrenheit directly', () => {
    expect(rothfuszHeatIndexF(90, 70)).toBeGreaterThan(104)
    expect(rothfuszHeatIndexF(90, 70)).toBeLessThan(107)
  })
})

describe('heat index — applicability boundaries', () => {
  it('is applicable exactly at the 27 C / 40% RH boundary', () => {
    const result = computeHeatIndex(HEAT_INDEX_MIN_TEMP_C, HEAT_INDEX_MIN_RH)
    expect(result.applicable).toBe(true)
    expect(result.method).toBe('rothfusz')
  })

  it('is not applicable just below 27 C', () => {
    const result = computeHeatIndex(26.6, 60)
    expect(result.applicable).toBe(false)
    expect(result.method).toBe('not-applicable')
    expect(result.valueC).toBeNull()
    expect(result.notes).toMatch(/does not apply/i)
  })

  it('is not applicable just below 40% RH and uses the simple formula', () => {
    const result = computeHeatIndex(35, 39)
    expect(result.applicable).toBe(false)
    expect(result.method).toBe('simple')
    expect(result.valueC).not.toBeNull()
    expect(result.notes).toMatch(/not defined/i)
  })

  it('keeps the air temperature as the reference in cool conditions', () => {
    const result = computeHeatIndex(15, 80)
    expect(result.valueC).toBeNull()
    expect(result.band).toBe('none')
  })
})

describe('heat index — input validation', () => {
  it('rejects humidity above 100%', () => {
    const result = computeHeatIndex(30, 101)
    expect(result.inputValid).toBe(false)
    expect(result.valueC).toBeNull()
    expect(result.notes).toMatch(/out of range/i)
  })

  it('rejects negative humidity', () => {
    expect(computeHeatIndex(30, -1).inputValid).toBe(false)
  })

  it('rejects implausible temperatures', () => {
    expect(computeHeatIndex(90, 50).inputValid).toBe(false)
    expect(computeHeatIndex(-90, 50).inputValid).toBe(false)
  })

  it('rejects non-finite input', () => {
    expect(computeHeatIndex(Number.NaN, 50).inputValid).toBe(false)
    expect(computeHeatIndex(30, Number.POSITIVE_INFINITY).inputValid).toBe(false)
  })

  it('accepts the documented valid ranges', () => {
    expect(computeHeatIndex(-50, 0).inputValid).toBe(true)
    expect(computeHeatIndex(60, 100).inputValid).toBe(true)
  })
})

describe('heat index — advisory bands', () => {
  it('maps the NOAA effects table', () => {
    expect(bandForHeatIndexC(26)).toBe('none')
    expect(bandForHeatIndexC(27)).toBe('caution')
    expect(bandForHeatIndexC(31.9)).toBe('caution')
    expect(bandForHeatIndexC(32)).toBe('extreme_caution')
    expect(bandForHeatIndexC(40.9)).toBe('extreme_caution')
    expect(bandForHeatIndexC(41)).toBe('danger')
    expect(bandForHeatIndexC(54)).toBe('danger')
    expect(bandForHeatIndexC(54.1)).toBe('extreme_danger')
    expect(bandForHeatIndexC(null)).toBe('none')
  })
})

describe('heat index — freshness', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z')

  it('treats observations older than the window as stale', () => {
    expect(isObservationStale('2026-06-01T11:00:00.000Z', now)).toBe(false)
    expect(isObservationStale('2026-06-01T10:59:00.000Z', now)).toBe(true)
    expect(isObservationStale('2026-05-31T12:00:00.000Z', now)).toBe(true)
  })

  it('treats an unusable timestamp as stale', () => {
    expect(isObservationStale('not-a-date', now)).toBe(true)
  })

  it('reports the age in seconds', () => {
    expect(observationAgeSeconds('2026-06-01T11:30:00.000Z', now)).toBe(1800)
    expect(observationAgeSeconds('not-a-date', now)).toBeNull()
  })

  it('uses a one hour freshness window', () => {
    expect(STALE_AFTER_SECONDS).toBe(3600)
  })
})

describe('heat index — rule version', () => {
  it('is versioned so stored advisories can be interpreted later', () => {
    expect(HEAT_INDEX_RULE_VERSION).toBe('heat_index_v1')
    expect(computeHeatIndex(32, 70).ruleVersion).toBe('heat_index_v1')
  })
})
