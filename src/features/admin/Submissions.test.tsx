import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Submissions from './Submissions'

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
    update(payload: Record<string, unknown>): Builder
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
      update(payload) {
        call.op = 'update'
        call.payload = payload
        return builder
      },
      then(onFulfilled, onRejected) {
        const key = `${table}:${call.op}`
        const result = state.results[key] ?? { data: [], error: null }
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

const SUBMISSIONS = [
  {
    id: 's1',
    kind: 'sentiment',
    sub_type: 'stressed',
    message: 'Exams are piling up and I cannot sleep.',
    location_id: null,
    emotion: 'stressed',
    stress_level: 4,
    status: 'new',
    submitted_by: 'u1',
    acknowledged_at: null,
    resolved_at: null,
    resolution_note: null,
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 's2',
    kind: 'incident_hazard',
    sub_type: 'bullying',
    message: 'A student is being bullied near the canteen.',
    location_id: 'l1',
    emotion: null,
    stress_level: null,
    status: 'new',
    submitted_by: 'u2',
    acknowledged_at: null,
    resolved_at: null,
    resolution_note: null,
    created_at: '2026-06-01T09:00:00Z',
  },
]

describe('Submissions', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'submissions:select': { data: SUBMISSIONS, error: null },
      'profiles:select': {
        data: [
          { id: 'u1', display_name: 'Student One' },
          { id: 'u2', display_name: 'Student Two' },
        ],
        error: null,
      },
      'submissions:update': { data: [], error: null },
    }
  })

  it('lists submissions with the category, sub-type and who sent them', async () => {
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    const list = await screen.findByRole('list')
    expect(within(list).getByText(/Sentiment & Feelings · Stressed/)).toBeInTheDocument()
    expect(within(list).getByText(/Incidents & Hazards · Bullying/)).toBeInTheDocument()
    expect(within(list).getByText(/from Student One/)).toBeInTheDocument()
  })

  it('shows the stress level for a wellbeing submission', async () => {
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/stress 4 \(High\)/)).toBeInTheDocument()
  })

  it('acknowledges a submission', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    await screen.findByRole('list')

    await user.click(screen.getAllByRole('button', { name: 'Acknowledge' })[0])

    const update = state.calls.find((call) => call.op === 'update')
    expect(update?.table).toBe('submissions')
    expect(update?.payload).toMatchObject({ status: 'acknowledged' })
  })

  it('marks a submission resolved', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    await screen.findByRole('list')

    await user.click(screen.getAllByRole('button', { name: 'Mark resolved' })[0])

    const update = state.calls.find((call) => call.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'resolved' })
  })

  it('filters by category', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    await screen.findByRole('list')

    await user.click(screen.getByRole('button', { name: 'Sentiment & Feelings' }))

    expect(screen.queryByText(/Incidents & Hazards · Bullying/)).not.toBeInTheDocument()
    expect(screen.getByText(/Sentiment & Feelings · Stressed/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing was submitted', async () => {
    state.results['submissions:select'] = { data: [], error: null }
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Nothing submitted in this view/)).toBeInTheDocument()
  })

  it('shows an error when the queue fails to load', async () => {
    state.results['submissions:select'] = { data: null, error: { message: 'submissions failed' } }
    render(
      <MemoryRouter>
        <Submissions />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('submissions failed')
  })
})
