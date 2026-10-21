import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { bandForHeatIndexC, isObservationStale, observationAgeSeconds } from './heatIndex'

interface Advisory {
  available: boolean
  source?: string
  observed_at?: string
  fetched_at?: string
  units?: { temperature: string; humidity: string }
  latitude?: number
  longitude?: number
  location_label?: string
  temperature_c?: number
  humidity_percent?: number
  heat_index?: {
    value_c: number | null
    method: string
    applicable: boolean
    band: string
    rule_version: string
    notes?: string
  }
  freshness?: { age_seconds: number; stale_after_seconds: number; stale: boolean }
  error?: string
  disclaimer?: string
}

interface StoredObservation {
  source: string
  observed_at: string
  fetched_at: string
  temperature_c: number
  humidity_percent: number
  heat_index_c: number | null
  rule_version: string
  is_stale: boolean
}

const BAND_LABELS: Record<string, string> = {
  none: 'No advisory band',
  caution: 'Caution',
  extreme_caution: 'Extreme caution',
  danger: 'Danger',
  extreme_danger: 'Extreme danger',
}

export default function WeatherAdvisory() {
  const workerUrl = import.meta.env.VITE_WEATHER_WORKER_URL as string | undefined
  const [advisory, setAdvisory] = useState<Advisory | null>(null)
  const [stored, setStored] = useState<StoredObservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchResults = useCallback(async (): Promise<{
    advisory: Advisory | null
    stored: StoredObservation | null
    error: string
  }> => {
    let live: Advisory | null = null
    let failure = ''
    if (workerUrl) {
      try {
        const response = await fetch(`${workerUrl.replace(/\/$/, '')}/`, {
          headers: { Accept: 'application/json' },
        })
        const body = (await response.json()) as Advisory
        if (!response.ok || body.available === false) {
          failure = body.error ?? 'weather unavailable'
        }
        live = body
      } catch {
        failure = 'weather unavailable'
      }
    } else {
      failure = 'weather service is not configured'
    }

    // Last stored observation, so a stale value can be shown with its age
    const { data } = await supabase
      .from('weather_observations')
      .select(
        'source, observed_at, fetched_at, temperature_c, humidity_percent, heat_index_c, rule_version, is_stale',
      )
      .order('fetched_at', { ascending: false })
      .limit(1)

    return {
      advisory: live,
      stored: (data?.[0] as StoredObservation | undefined) ?? null,
      error: failure,
    }
  }, [workerUrl])

  const applyResults = useCallback(
    (results: { advisory: Advisory | null; stored: StoredObservation | null; error: string }) => {
      setAdvisory(results.advisory)
      setStored(results.stored)
      setError(results.error)
      setLoading(false)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then((results) => {
      if (cancelled) return
      applyResults(results)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  if (loading) {
    return (
      <section className="dash-section">
        <h2>Weather advisory</h2>
        <p role="status">Loading weather…</p>
      </section>
    )
  }

  const live = advisory?.available ? advisory : null
  const heatIndexC = live?.heat_index?.value_c ?? null
  const band = live?.heat_index?.applicable
    ? (live.heat_index.band ?? bandForHeatIndexC(heatIndexC))
    : 'none'
  const stale = live?.freshness?.stale ?? isObservationStale(live?.fetched_at ?? '')

  return (
    <section className="dash-section">
      <h2>Weather advisory</h2>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {live ? (
        <>
          <ul className="dash-tiles">
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">
                {live.temperature_c?.toFixed(1)}
              </span>
              <span className="dash-label">air temperature (C)</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">
                {live.humidity_percent?.toFixed(0)}
              </span>
              <span className="dash-label">relative humidity (%)</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">
                {heatIndexC === null ? 'n/a' : heatIndexC.toFixed(1)}
              </span>
              <span className="dash-label">heat index (C)</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" style={{ fontSize: '0.9375rem' }}>
                {BAND_LABELS[band] ?? band}
              </span>
              <span className="dash-label">advisory band</span>
            </li>
          </ul>

          <p className="loc-meta">
            Source: {live.source} · observed {live.observed_at} · fetched {live.fetched_at} ·{' '}
            {live.freshness?.age_seconds ?? 0}s old{stale ? ' · STALE' : ''} · rule{' '}
            {live.heat_index?.rule_version}
          </p>

          {live.location_label && <p className="loc-meta">Location: {live.location_label}</p>}

          {live.heat_index && !live.heat_index.applicable && live.heat_index.notes && (
            <p className="loc-meta">{live.heat_index.notes}</p>
          )}

          <p className="rep-notice">
            {live.disclaimer ??
              'External weather data are not indoor classroom measurements. Advisory only.'}
          </p>
        </>
      ) : (
        <>
          <p className="loc-empty">No live weather reading right now.</p>
          {stored && (
            <p className="loc-meta">
              Last recorded reading: {stored.temperature_c} C, {stored.humidity_percent}% humidity
              {stored.heat_index_c !== null ? `, heat index ${stored.heat_index_c} C` : ''} — from{' '}
              {stored.fetched_at}
              {isObservationStale(stored.fetched_at) ? ' (STALE)' : ''} (source {stored.source}, rule{' '}
              {stored.rule_version}, age {observationAgeSeconds(stored.fetched_at)}s).
            </p>
          )}
        </>
      )}
    </section>
  )
}
