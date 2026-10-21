/**
 * SENTINEL weather worker (Phase 6).
 *
 * Server-side weather retrieval for the SENTINEL app. It runs on Cloudflare
 * Workers and:
 *   1. fetches the current observation for the school's fixed coordinates from
 *      Open-Meteo (free, no API key),
 *   2. computes the heat index with the SAME module the app uses
 *      (src/features/weather/heatIndex.ts) so the two can never drift,
 *   3. stores the observation in Supabase (server write, service role secret),
 *   4. returns the advisory with source, timestamps, units, freshness and the
 *      calculation rule version.
 *
 * It never returns a value it cannot attribute, and it never makes a decision:
 * the response is advisory input only (see docs/HEAT_INDEX.md).
 */

import { computeHeatIndex, isObservationStale, STALE_AFTER_SECONDS } from '../src/features/weather/heatIndex'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SCHOOL_ID: string
  LATITUDE: string
  LONGITUDE: string
  LOCATION_LABEL: string
  ALLOWED_ORIGIN: string
}

const SOURCE = 'open-meteo'

interface OpenMeteoResponse {
  current?: {
    time?: string
    temperature_2m?: number
    relative_humidity_2m?: number
  }
  error?: boolean
  reason?: string
}

function json(body: unknown, status: number, origin: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

async function fetchObservation(env: Env): Promise<{
  observedAt: string
  temperatureC: number
  humidityPercent: number
  latitude: number
  longitude: number
}> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${encodeURIComponent(env.LATITUDE)}` +
    `&longitude=${encodeURIComponent(env.LONGITUDE)}` +
    '&current=temperature_2m,relative_humidity_2m&timezone=UTC'

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`weather provider returned ${response.status}`)
  }
  const body = (await response.json()) as OpenMeteoResponse
  if (body.error) {
    throw new Error(`weather provider error: ${body.reason ?? 'unknown'}`)
  }
  const temperatureC = body.current?.temperature_2m
  const humidityPercent = body.current?.relative_humidity_2m
  if (typeof temperatureC !== 'number' || typeof humidityPercent !== 'number') {
    throw new Error('weather provider response missing temperature or humidity')
  }
  return {
    observedAt: body.current?.time ? `${body.current.time}:00Z`.replace(/:00:00Z$/, ':00Z') : new Date().toISOString(),
    temperatureC,
    humidityPercent,
    latitude: Number(env.LATITUDE),
    longitude: Number(env.LONGITUDE),
  }
}

async function storeObservation(
  env: Env,
  observation: {
    observedAt: string
    temperatureC: number
    humidityPercent: number
    latitude: number
    longitude: number
  },
  heatIndex: ReturnType<typeof computeHeatIndex>,
  fetchedAt: string,
  isStale: boolean,
): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/weather_observations`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      school_id: env.SCHOOL_ID,
      source: SOURCE,
      observed_at: observation.observedAt,
      fetched_at: fetchedAt,
      latitude: observation.latitude,
      longitude: observation.longitude,
      temperature_c: observation.temperatureC,
      humidity_percent: observation.humidityPercent,
      heat_index_c: heatIndex.valueC,
      heat_index_method: heatIndex.method,
      heat_index_applicable: heatIndex.applicable,
      rule_version: heatIndex.ruleVersion,
      is_stale: isStale,
    }),
  })
  if (!response.ok) {
    // Storing is best-effort: the advisory is still valid without a stored row.
    console.error('failed to store observation', response.status, await response.text())
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || '*'

    if (request.method === 'OPTIONS') {
      return json({}, 204, origin)
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, origin)
    }

    const fetchedAt = new Date().toISOString()

    let observation
    try {
      observation = await fetchObservation(env)
    } catch (error) {
      return json(
        {
          available: false,
          error: 'weather unavailable',
          detail: error instanceof Error ? error.message : 'unknown error',
          source: SOURCE,
          fetched_at: fetchedAt,
          stale: true,
          disclaimer:
            'External weather data are not indoor classroom measurements. Advisory only.',
        },
        502,
        origin,
      )
    }

    const heatIndex = computeHeatIndex(observation.temperatureC, observation.humidityPercent)
    const stale = isObservationStale(fetchedAt)
    await storeObservation(env, observation, heatIndex, fetchedAt, stale)

    const observedAtMs = Date.parse(observation.observedAt)
    const ageSeconds = Number.isNaN(observedAtMs)
      ? 0
      : Math.max(0, Math.round((Date.parse(fetchedAt) - observedAtMs) / 1000))

    return json(
      {
        available: true,
        source: SOURCE,
        observed_at: observation.observedAt,
        fetched_at: fetchedAt,
        units: { temperature: 'celsius', humidity: 'percent' },
        latitude: observation.latitude,
        longitude: observation.longitude,
        location_label: env.LOCATION_LABEL || 'school coordinates not configured',
        temperature_c: observation.temperatureC,
        humidity_percent: observation.humidityPercent,
        heat_index: {
          value_c: heatIndex.valueC,
          method: heatIndex.method,
          applicable: heatIndex.applicable,
          band: heatIndex.band,
          rule_version: heatIndex.ruleVersion,
          notes: heatIndex.notes,
        },
        freshness: {
          age_seconds: ageSeconds,
          stale_after_seconds: STALE_AFTER_SECONDS,
          stale,
        },
        disclaimer:
          'External weather data are not indoor classroom measurements. Advisory only — this does ' +
          'not automatically suspend classes or trigger any emergency action.',
      },
      200,
      origin,
    )
  },
}
