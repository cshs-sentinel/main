import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import AdminReports from './AdminReports'
import { AuthContext } from '../auth/AuthContext'
import type { AuthContextValue } from '../auth/AuthContext'

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111'

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
    insert(payload: Record<string, unknown>): Builder
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
      insert(payload) {
        call.op = 'insert'
        call.payload = payload
        return builder
      },
      update(payload) {
        call.op = 'update'
        call.payload = payload
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
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      }),
    },
  },
}))

const REPORTS = [
  {
    id: 'r1',
    category: 'safety_hazard',
    description: 'Loose handrail by the science lab',
    status: 'open',
    location_id: 'l1',
    created_at: '2026-03-01T10:00:00.000Z',
    locations: { name: 'Science Lab' },
  },
  {
    id: 'r2',
    category: 'facility_damage',
    description: 'Cracked step in the gym entrance',
    status: 'acknowledged',
    location_id: null,
    created_at: '2026-02-28T09:00:00.000Z',
    locations: null,
  },
]

const mockUser = { id: 'responder-1' } as User

function renderPage() {
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role: 'responder',
    schoolId: SCHOOL_ID,
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <AdminReports />
    </AuthContext.Provider>,
  )
}

function updateCalls() {
  return state.calls.filter((call) => call.table === 'hazard_reports' && call.op === 'update')
}

describe('AdminReports', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'hazard_reports:select': { data: REPORTS, error: null },
      'report_attachments:select': { data: [], error: null },
      'hazard_reports:update': { data: null, error: null },
    }
  })

  it('lists the school reports for review', async () => {
    renderPage()
    expect(await screen.findByText('Loose handrail by the science lab')).toBeInTheDocument()
    expect(screen.getByText('Cracked step in the gym entrance')).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['hazard_reports:select'] = { data: null, error: { message: 'queue failed' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('queue failed')
  })

  it('acknowledges an open report', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => expect(updateCalls()).toHaveLength(1))
    expect(updateCalls()[0].payload).toEqual({ status: 'acknowledged' })
    expect(updateCalls()[0].filters).toMatchObject({ id: 'r1' })
  })

  it('resolves an acknowledged report', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Cracked step in the gym entrance')

    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(updateCalls()).toHaveLength(1))
    expect(updateCalls()[0].payload).toEqual({ status: 'resolved' })
    expect(updateCalls()[0].filters).toMatchObject({ id: 'r2' })
  })

  it('filters the queue by status', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    await user.click(screen.getByRole('button', { name: 'Acknowledged' }))

    await waitFor(() => {
      expect(screen.queryByText('Loose handrail by the science lab')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Cracked step in the gym entrance')).toBeInTheDocument()
  })
})
