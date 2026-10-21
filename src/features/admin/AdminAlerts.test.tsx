import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter } from 'react-router-dom'
import AdminAlerts from './AdminAlerts'
import { AuthContext } from '../auth/AuthContext'
import type { AuthContextValue, AppRole } from '../auth/AuthContext'

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
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      return state.results[`rpc:${name}`] ?? { data: null, error: null }
    },
  },
}))

const DRAFT = {
  id: 'a1',
  title: 'Drill on Friday',
  body: 'Evacuation drill at 10:00',
  severity: 'advisory',
  status: 'draft',
  target_scope: 'all',
  target_role: null,
  created_by: 'admin-1',
  approved_at: null,
  published_at: null,
  cancelled_at: null,
  cancel_reason: null,
  supersedes_id: null,
  version: 1,
  created_at: '2026-06-01T08:00:00Z',
  incident_id: null,
}

const PUBLISHED = {
  ...DRAFT,
  id: 'a2',
  title: 'Gate closed at 16:00',
  status: 'published',
  published_at: '2026-06-01T10:00:00Z',
}

const mockUser = { id: 'admin-1' } as User

function renderPage(role: AppRole) {
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role,
    schoolId: SCHOOL_ID,
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <AdminAlerts />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AdminAlerts', () => {
  beforeEach(() => {
    state.calls = []
    state.rpcCalls = []
    state.results = {
      'alerts:select': { data: [DRAFT, PUBLISHED], error: null },
      'alerts:insert': { data: { id: 'a3' }, error: null },
      'alerts:update': { data: null, error: null },
    }
  })

  it('lists drafts and published alerts with their status', async () => {
    renderPage('administrator')
    await screen.findByText('Drill on Friday')
    const list = screen.getAllByRole('list')[0]
    expect(within(list).getByText('Drill on Friday')).toBeInTheDocument()
    expect(within(list).getByText(/^Draft · Everyone in the school/)).toBeInTheDocument()
    expect(within(list).getByText('Gate closed at 16:00')).toBeInTheDocument()
    expect(within(list).getByText(/^Published · Everyone in the school/)).toBeInTheDocument()
  })

  it('saves a draft for the current school', async () => {
    const user = userEvent.setup()
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weather drill' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Drill at 11:00' } })
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      const insert = state.calls.find((call) => call.table === 'alerts' && call.op === 'insert')
      expect(insert?.payload).toMatchObject({
        school_id: SCHOOL_ID,
        title: 'Weather drill',
        body: 'Drill at 11:00',
        severity: 'advisory',
        target_scope: 'all',
      })
      expect(insert?.payload?.status).toBeUndefined()
    })
  })

  it('rejects a draft with no title or message', async () => {
    const user = userEvent.setup()
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('needs a title and a message')
  })

  it('approves a draft through the server workflow', async () => {
    const user = userEvent.setup()
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].name).toBe('approve_alert')
    expect(state.rpcCalls[0].args).toMatchObject({ alert_id: 'a1' })
  })

  it('publishes an approved alert and says nothing was sent', async () => {
    const user = userEvent.setup()
    state.results['alerts:select'] = { data: [{ ...DRAFT, status: 'approved' }], error: null }
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].name).toBe('publish_alert')
    expect(await screen.findByRole('status')).toHaveTextContent('No SMS or email was sent')
  })

  it('does not offer approval to a responder', async () => {
    renderPage('responder')
    await screen.findByText('Drill on Friday')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('creates a correction with a reason', async () => {
    const user = userEvent.setup()
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    await user.click(screen.getByRole('button', { name: 'Correct' }))
    fireEvent.change(screen.getByLabelText('Corrected title'), {
      target: { value: 'Drill on Friday (corrected)' },
    })
    fireEvent.change(screen.getByLabelText('Reason for the correction'), {
      target: { value: 'Time changed' },
    })
    await user.click(screen.getByRole('button', { name: 'Create correction' }))

    await waitFor(() => expect(state.rpcCalls).toHaveLength(1))
    expect(state.rpcCalls[0].name).toBe('correct_alert')
    expect(state.rpcCalls[0].args).toMatchObject({
      alert_id: 'a2',
      new_title: 'Drill on Friday (corrected)',
      reason: 'Time changed',
    })
  })

  it('shows the error returned by the server', async () => {
    const user = userEvent.setup()
    state.results['rpc:approve_alert'] = {
      data: null,
      error: { message: 'only administrators may approve alerts' },
    }
    renderPage('administrator')
    await screen.findByText('Drill on Friday')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'only administrators may approve alerts',
    )
  })
})
