import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WeatherAdvisory from './WeatherAdvisory'

const { state } = vi.hoisted(() => {
  interface QueryResult {
    data: unknown
    error: { message: string } | null
  }
  const state = {
    results: {} as Record<string, QueryResult>,
    fetchCalls: [] as string[],
  }
  return { state }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (onFulfilled?: (value: unknown) => unknown) =>
          Promise.resolve(
            state.results[`${table}:select`] ?? { data: [], error: null },
          ).then(onFulfilled),
      }
      return chain
    },
  },
}))

const LIVE_ADVISORY = {
  available: true,
  source: 'open-meteo',
  observed_at: '2026-06-01T11:00:00Z',
  fetched_at: new Date().toISOString(),
  temperature_c: 33.4,
  humidity_percent: 62,
  location_label: 'school coordinates',
  heat_index: {
    value_c: 40.1,
    method: 'rothfusz',
    applicable: true,
    band: 'extreme_caution',
    rule_version: 'heat_index_v1',
    notes: 'advisory',
  },
  freshness: { age_seconds: 120, stale_after_seconds: 3600, stale: false },
  disclaimer: 'External weather data are not indoor classroom measurements. Advisory only.',
}

describe('WeatherAdvisory', () => {
  beforeEach(() => {
    state.results = { 'weather_observations:select': { data: [], error: null } }
    state.fetchCalls = []
    vi.stubGlobal('fetch', async (url: string) => {
      state.fetchCalls.push(String(url))
      return {
        ok: true,
        status: 200,
        json: async () => LIVE_ADVISORY,
      } as unknown as Response
    })
    vi.stubEnv('VITE_WEATHER_WORKER_URL', 'https://worker.example')
  })

  it('shows the advisory values, source, freshness and rule version', async () => {
    render(<WeatherAdvisory />)
    expect(await screen.findByText('Weather advisory')).toBeInTheDocument()
    expect(screen.getByText('33.4')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(screen.getByText('40.1')).toBeInTheDocument()
    expect(screen.getByText('Extreme caution')).toBeInTheDocument()
    expect(screen.getByText(/open-meteo/)).toBeInTheDocument()
    expect(screen.getByText(/heat_index_v1/)).toBeInTheDocument()
  })

  it('always shows the advisory-only disclaimer', async () => {
    render(<WeatherAdvisory />)
    expect(
      await screen.findByText(/not indoor classroom measurements/i),
    ).toBeInTheDocument()
  })

  it('reports an unavailable weather service explicitly', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 502,
      json: async () => ({ available: false, error: 'weather unavailable' }),
    }) as unknown as Response)
    render(<WeatherAdvisory />)
    expect(await screen.findByRole('alert')).toHaveTextContent('weather unavailable')
    expect(screen.getByText(/No live weather reading/)).toBeInTheDocument()
  })

  it('shows the last stored observation as stale when the service is down', async () => {
    state.results['weather_observations:select'] = {
      data: [
        {
          source: 'open-meteo',
          observed_at: '2026-05-30T09:00:00Z',
          fetched_at: '2026-05-30T09:00:00Z',
          temperature_c: 21.5,
          humidity_percent: 80,
          heat_index_c: null,
          rule_version: 'heat_index_v1',
          is_stale: true,
        },
      ],
      error: null,
    }
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 502,
      json: async () => ({ available: false, error: 'weather unavailable' }),
    }) as unknown as Response)
    render(<WeatherAdvisory />)
    expect(await screen.findByText(/Last recorded reading/)).toBeInTheDocument()
    expect(screen.getByText(/STALE/)).toBeInTheDocument()
  })

  it('requests the worker endpoint', async () => {
    render(<WeatherAdvisory />)
    await waitFor(() => expect(state.fetchCalls.length).toBeGreaterThan(0))
    expect(state.fetchCalls[0]).toContain('https://worker.example')
  })
})
