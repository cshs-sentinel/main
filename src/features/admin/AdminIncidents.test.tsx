import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import AdminIncidents from './AdminIncidents'
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
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      return state.results[`rpc:${name}`] ?? { data: null, error: null }
    },
  },
}))

const INCIDENTS = [
  {
    id: 'i1',
    case_ref: 'SNT-2026-0002',
    status: 'acknowledged',
    category: 'medical',
    description: 'Student fell in the stairwell',
    location_id: 'l1',
    created_at: '2026-03-01T10:00:00.000Z',
    acknowledged_at: '2026-03-01T10:01:00.000Z',
    assigned_at: null,
    resolved_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    resolution_notes: null,
    locations: { name: 'Main Building' },
  },
]

const HISTORY = [
  {
    id: 1,
    incident_id: 'i1',
    from_status: 'new',
    to_status: 'acknowledged',
    actor_id: 'responder-1',
    note: null,
    created_at: '2026-03-01T10:01:00.000Z',
  },
]

const NOTES = [
  {
    id: 1,
    incident_id: 'i1',
    author_id: 'responder-1',
    body: 'First aid called',
    created_at: '2026-03-01T10:02:00.000Z',
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
      <AdminIncidents />
    </AuthContext.Provider>,
  )
}

describe('AdminIncidents', () => {
  beforeEach(() => {
    state.calls = []
    state.rpcCalls = []
    state.results = {
      'incidents:select': { data: INCIDENTS, error: null },
      'incident_status_history:select': { data: HISTORY, error: null },
      'incident_notes:select': { data: NOTES, error: null },
      'incident_notes:insert': { data: { id: 2 }, error: null },
    }
  })

  it('lists open cases with their timeline and notes', async () => {
    renderPage()
    expect(await screen.findByText('SNT-2026-0002')).toBeInTheDocument()
    const list = screen.getAllByRole('list')[0]
    expect(within(list).getByText('Student fell in the stairwell')).toBeInTheDocument()
    expect(screen.getByText(/First aid called/)).toBeInTheDocument()
    expect(screen.getAllByText(/Acknowledged/).length).toBeGreaterThan(0)
  })

  it('shows an error when the queue fails to load', async () => {
    state.results['incidents:select'] = { data: null, error: { message: 'queue failed' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('queue failed')
  })

  it('assigns an acknowledged case to the responder', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0002')

    await user.click(screen.getByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].name).toBe('transition_incident')
    expect(state.rpcCalls[0].args).toMatchObject({
      incident_id: 'i1',
      new_status: 'assigned',
    })
  })

  it('resolves a case with the resolution note', async () => {
    const user = userEvent.setup()
    state.results['incidents:select'] = {
      data: [{ ...INCIDENTS[0], status: 'in_progress' }],
      error: null,
    }
    renderPage()
    await screen.findByText('SNT-2026-0002')

    fireEvent.change(screen.getByLabelText('Resolution note'), {
      target: { value: 'Student treated on site' },
    })
    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].args).toMatchObject({
      new_status: 'resolved',
      note: 'Student treated on site',
    })
  })

  it('adds a response note', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0002')

    fireEvent.change(screen.getByLabelText('Add a response note'), {
      target: { value: 'Ambulance on the way' },
    })
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      const insert = state.calls.find(
        (call) => call.table === 'incident_notes' && call.op === 'insert',
      )
      expect(insert?.payload).toMatchObject({
        incident_id: 'i1',
        body: 'Ambulance on the way',
      })
    })
  })

  it('refuses to send an empty note', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0002')

    await user.click(screen.getByRole('button', { name: 'Add note' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Write a note')
    const insert = state.calls.find(
      (call) => call.table === 'incident_notes' && call.op === 'insert',
    )
    expect(insert).toBeUndefined()
  })
})
