import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import CheckIn from './CheckIn'
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
    limit?: number
    select?: string
  }

  interface Builder {
    select(columns: string): Builder
    order(column: string, options?: { ascending?: boolean }): Builder
    limit(count: number): Builder
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
      limit(count) {
        call.limit = count
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
  },
}))

const CHECK_INS = [
  {
    id: 'c1',
    location_source: 'self_selected',
    period: 'Period 3',
    status: 'safe',
    checked_in_at: '2026-03-01T10:00:00.000Z',
    locations: { name: 'Science Lab' },
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
      <CheckIn />
    </AuthContext.Provider>,
  )
}

function insertCalls() {
  return state.calls.filter((call) => call.table === 'check_ins' && call.op === 'insert')
}

describe('CheckIn', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'check_ins:select': { data: CHECK_INS, error: null },
      'locations:select': { data: [{ id: 'l1', name: 'Science Lab' }], error: null },
      'check_ins:insert': { data: { id: 'c-new' }, error: null },
    }
  })

  it('states that a check-in is not a verified location', async () => {
    renderPage()
    expect(
      await screen.findByText(/not.*a verified location/i),
    ).toBeInTheDocument()
  })

  it('lists recent check-ins with their source label', async () => {
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getByText(/Period 3/)).toBeInTheDocument()
    expect(within(list).getByText('Self-selected')).toBeInTheDocument()
    expect(within(list).getByText(/Science Lab/)).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['check_ins:select'] = { data: null, error: { message: 'check-in load failed' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('check-in load failed')
  })

  it('records a safe check-in for the current school', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('list')

    await user.selectOptions(screen.getByLabelText('Location (optional)'), 'l1')
    fireEvent.change(screen.getByLabelText('Period label (optional)'), {
      target: { value: 'Period 4' },
    })
    await user.click(screen.getByRole('button', { name: 'I am safe' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      school_id: SCHOOL_ID,
      location_source: 'self_selected',
      location_id: 'l1',
      period: 'Period 4',
      status: 'safe',
    })
  })

  it('records that help is needed', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('list')

    await user.click(screen.getByRole('button', { name: 'I need help' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({ status: 'need_help' })
    expect(await screen.findByRole('status')).toHaveTextContent(/need help/i)
  })

  it('surfaces a server rejection of the check-in', async () => {
    const user = userEvent.setup()
    state.results['check_ins:insert'] = {
      data: null,
      error: { message: 'only responders or administrators can record a staff-verified location' },
    }
    renderPage()
    await screen.findByRole('list')

    await user.selectOptions(screen.getByLabelText('How was this location chosen?'), 'staff_verified')
    await user.click(screen.getByRole('button', { name: 'I am safe' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('staff-verified')
  })
})
