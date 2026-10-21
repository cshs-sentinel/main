// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SCHOOL_ID: '11111111-1111-1111-1111-111111111111',
  LATITUDE: '12.34',
  LONGITUDE: '56.78',
  LOCATION_LABEL: 'school coordinates',
  ALLOWED_ORIGIN: 'https://app.example',
}

interface WorkerResponse {
  available?: boolean
  error?: string
  observed_at?: string
  fetched_at?: string
  freshness?: { age_seconds: number; stale_after_seconds: number; stale: boolean }
  heat_index?: { value_c: number | null; applicable: boolean; rule_version: string }
}

/** Open-Meteo reports the start of the current hour, in "YYYY-MM-DDTHH:mm". */
function providerTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16)
}

function stubProvider(temperatureC: number, humidityPercent: number, time: string) {
  const calls: { url: string; body: string | undefined }[] = []
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url.includes('open-meteo')) {
      return new Response(
        JSON.stringify({
          current: {
            time,
            temperature_2m: temperatureC,
            relative_humidity_2m: humidityPercent,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('', { status: 201 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

async function callWorker() {
  const response = await worker.fetch(new Request('https://worker.test/'), ENV)
  return { status: response.status, body: (await response.json()) as WorkerResponse }
}

describe('weather worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports a fresh observation as not stale', async () => {
    stubProvider(33, 60, providerTime(Date.now()))
    const { status, body } = await callWorker()

    expect(status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.freshness?.stale).toBe(false)
    expect(body.freshness?.age_seconds).toBeLessThan(body.freshness?.stale_after_seconds ?? 0)
  })

  it('flags an observation older than the freshness window as stale', async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const calls = stubProvider(35, 60, providerTime(twoHoursAgo))
    const { status, body } = await callWorker()

    expect(status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.freshness?.stale).toBe(true)
    expect(body.freshness?.age_seconds).toBeGreaterThan(body.freshness?.stale_after_seconds ?? 0)

    const stored = calls.find((call) => call.url.includes('/rest/v1/weather_observations'))
    expect(stored).toBeDefined()
    expect(JSON.parse(stored?.body ?? '{}')).toMatchObject({ is_stale: true })
  })

  it('stores the observation with its source, rule version and timestamps', async () => {
    const calls = stubProvider(35, 60, providerTime(Date.now()))
    await callWorker()

    const stored = calls.find((call) => call.url.includes('/rest/v1/weather_observations'))
    const row = JSON.parse(stored?.body ?? '{}')
    expect(row).toMatchObject({
      school_id: ENV.SCHOOL_ID,
      source: 'open-meteo',
      heat_index_method: 'rothfusz',
      heat_index_applicable: true,
      rule_version: 'heat_index_v1',
      is_stale: false,
    })
    expect(row.fetched_at).toBeTruthy()
    expect(row.observed_at).toBeTruthy()
  })

  it('answers 502 and stores nothing when the provider is unreachable', async () => {
    const calls = stubProvider(35, 60, providerTime(Date.now()))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push({ url, body: undefined })
        if (url.includes('open-meteo')) throw new Error('network down')
        return new Response('', { status: 201 })
      }),
    )

    const { status, body } = await callWorker()

    expect(status).toBe(502)
    expect(body.available).toBe(false)
    expect(body.error).toBe('weather unavailable')
    expect(calls.some((call) => call.url.includes('/rest/v1/weather_observations'))).toBe(false)
  })

  it('never returns a heat index that is not applicable as a real value', async () => {
    stubProvider(12, 30, providerTime(Date.now()))
    const { body } = await callWorker()

    expect(body.heat_index?.applicable).toBe(false)
    expect(body.heat_index?.rule_version).toBe('heat_index_v1')
  })
})
