import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Schedule from './Schedule'

const { state, makeBuilder } = vi.hoisted(() => {
  interface CallRecord {
    table: string
    op: string
    payload?: Record<string, unknown>
    filters: Record<string, unknown>
    order: { column: string; options?: unknown } | null
    select?: string
  }

  interface Builder {
    select(columns: string): Builder
    order(column: string, options?: { ascending?: boolean }): Builder
    eq(column: string, value: unknown): Builder
    then(
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ): Promise<unknown>
  }

  interface QueryResult {
    data: unknown
    error: { message: string } | null
  }

  const state = {
    calls: [] as CallRecord[],
    results: {} as Record<string, QueryResult>,
  }

  function makeBuilder(table: string): Builder {
    const call: CallRecord = { table, op: 'select', filters: {}, order: null }
    state.calls.push(call)
    const builder: Builder = {
      select(columns) {
        call.select = columns
        return builder
      },
      order(column, options) {
        call.order = { column, options }
        return builder
      },
      eq(column, value) {
        call.filters[column] = value
        return builder
      },
      then(onFulfilled, onRejected) {
        const key = `${table}:${call.op}`
        const result = state.results[key] ?? { data: null, error: null }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  return { state, makeBuilder }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
  },
}))

const ROWS = [
  {
    id: 's1',
    location_id: 'l1',
    day_of_week: 1,
    start_time: '08:00:00',
    end_time: '09:00:00',
    effective_from: '2026-01-05',
    effective_until: null,
    label: 'Period 1',
    status: 'active',
    locations: { name: 'Room 101' },
  },
  {
    id: 's3',
    location_id: 'l3',
    day_of_week: 5,
    start_time: '13:00:00',
    end_time: '14:00:00',
    effective_from: '2026-01-05',
    effective_until: '2026-06-30',
    label: null,
    status: 'active',
    locations: { name: 'Gym' },
  },
]

describe('Schedule', () => {
  beforeEach(() => {
    state.calls.length = 0
    state.results = {
      'schedules:select': { data: ROWS, error: null },
    }
  })

  it('groups active schedule rows by day with location names', async () => {
    render(<Schedule />)
    expect(await screen.findByRole('heading', { name: 'Monday' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Friday' })).toBeInTheDocument()
    expect(screen.getByText('Room 101')).toBeInTheDocument()
    expect(screen.getByText('Gym')).toBeInTheDocument()
    expect(screen.getByText('08:00–09:00')).toBeInTheDocument()

    const dayHeadings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(dayHeadings).toEqual(['Monday', 'Friday'])
  })

  it('labels rows as schedule-derived and warns they are not verified locations', async () => {
    render(<Schedule />)
    await screen.findByRole('heading', { name: 'Monday' })

    expect(screen.getByRole('note')).toHaveTextContent(/not verified or observed locations/)
    expect(screen.getAllByText('schedule-derived')).toHaveLength(2)
  })

  it('shows an empty state when no schedule is published', async () => {
    state.results['schedules:select'] = { data: [], error: null }
    render(<Schedule />)
    expect(await screen.findByText(/No schedule has been published/)).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['schedules:select'] = { data: null, error: { message: 'RLS denied' } }
    render(<Schedule />)
    expect(await screen.findByRole('alert')).toHaveTextContent('RLS denied')
  })

  it('queries only active schedules', async () => {
    render(<Schedule />)
    await screen.findByRole('heading', { name: 'Monday' })

    const call = state.calls.find((c) => c.table === 'schedules' && c.op === 'select')
    expect(call?.filters).toEqual({ status: 'active' })
  })
})
