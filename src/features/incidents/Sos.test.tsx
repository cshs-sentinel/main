import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import Sos from './Sos'
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
    single(): Promise<unknown>
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
      update(payload) {
        call.op = 'update'
        call.payload = payload
        return builder
      },
      single() {
        return Promise.resolve(
          state.results[`${table}:${call.op}`] ?? { data: null, error: null },
        )
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
    case_ref: 'SNT-2026-0001',
    status: 'new',
    category: 'emergency',
    description: 'Smoke on the second floor',
    location_id: 'l1',
    created_at: '2026-03-01T10:00:00.000Z',
    acknowledged_at: null,
    assigned_at: null,
    resolved_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    resolution_notes: null,
    locations: { name: 'Main Building' },
  },
]

const mockUser = { id: 'student-1' } as User

function renderPage() {
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role: 'student',
    schoolId: SCHOOL_ID,
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <Sos />
    </AuthContext.Provider>,
  )
}

function insertCalls() {
  return state.calls.filter((call) => call.table === 'incidents' && call.op === 'insert')
}

describe('Sos', () => {
  beforeEach(() => {
    state.calls = []
    state.rpcCalls = []
    state.results = {
      'incidents:select': { data: INCIDENTS, error: null },
      'locations:select': { data: [{ id: 'l1', name: 'Main Building' }], error: null },
      'incidents:insert': { data: { id: 'i-new', case_ref: 'SNT-2026-0007', status: 'new' }, error: null },
    }
  })

  it('tells the user this does not replace emergency services', async () => {
    renderPage()
    expect(await screen.findByText(/does not replace emergency services/i)).toBeInTheDocument()
  })

  it('lists the cases raised by the current user', async () => {
    renderPage()
    expect(await screen.findByText('SNT-2026-0001')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('Smoke on the second floor')).toBeInTheDocument()
    expect(within(list).getByText('New')).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['incidents:select'] = { data: null, error: { message: 'case load failed' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('case load failed')
  })

  it('rejects a description that is too short', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0001')

    await user.click(screen.getByRole('button', { name: 'Send SOS' }))
    fireEvent.change(screen.getByLabelText('What is happening?'), { target: { value: 'x' } })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 3 characters')
    expect(insertCalls()).toHaveLength(0)
  })

  it('raises an incident and shows the case reference', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0001')

    await user.click(screen.getByRole('button', { name: 'Send SOS' }))
    fireEvent.change(screen.getByLabelText('What is happening?'), {
      target: { value: 'Fire alarm in the gym' },
    })
    await user.selectOptions(screen.getByLabelText('Location (optional)'), 'l1')
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      school_id: SCHOOL_ID,
      category: 'emergency',
      description: 'Fire alarm in the gym',
      location_id: 'l1',
    })
    expect(await screen.findByText('SNT-2026-0007')).toBeInTheDocument()
  })

  it('surfaces the server duplicate-guard message', async () => {
    const user = userEvent.setup()
    state.results['incidents:insert'] = {
      data: null,
      error: { message: 'you already have an open incident (SNT-2026-0001); please wait before raising another' },
    }
    renderPage()
    await screen.findByText('SNT-2026-0001')

    await user.click(screen.getByRole('button', { name: 'Send SOS' }))
    fireEvent.change(screen.getByLabelText('What is happening?'), {
      target: { value: 'Fire alarm in the gym' },
    })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already have an open incident')
  })

  it('lets the person who raised a case cancel it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('SNT-2026-0001')

    await user.click(screen.getByRole('button', { name: 'Cancel case' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].name).toBe('transition_incident')
    expect(state.rpcCalls[0].args).toMatchObject({
      incident_id: 'i1',
      new_status: 'cancelled',
    })
  })
})
