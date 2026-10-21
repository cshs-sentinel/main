import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'
import { AuthContext } from '../auth/AuthContext'
import type { AuthContextValue, AppRole } from '../auth/AuthContext'

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
    rpcResults: {} as Record<string, QueryResult>,
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
    rpc: async (name: string) => state.rpcResults[name] ?? { data: null, error: null },
  },
}))

const mockUser = { id: 'student-1' } as User

function renderPage(
  role: AppRole,
  counts: Record<string, unknown>,
  override?: { data: unknown; error: { message: string } | null },
) {
  state.rpcResults.dashboard_counts = override ?? { data: counts, error: null }
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role,
    schoolId: '11111111-1111-1111-1111-111111111111',
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

function tileValues(): number[] {
  return screen
    .getAllByTestId('dash-tile-value')
    .map((node) => Number(node.textContent))
}

describe('Dashboard', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'incidents:select': { data: [], error: null },
    }
  })

  it('shows a student only their own counts', async () => {
    renderPage('student', {
      role: 'student',
      my_check_ins_today: 2,
      my_open_incidents: 1,
      my_open_reports: 0,
    })

    expect(await screen.findByText('My status')).toBeInTheDocument()
    expect(tileValues()).toEqual([2, 1, 0])
    expect(screen.queryByText('School summary')).not.toBeInTheDocument()
  })

  it('does not show school-wide numbers to a student', async () => {
    renderPage('student', {
      role: 'student',
      my_check_ins_today: 1,
      // A compromised or buggy server response must not be trusted blindly:
      // the UI must not render school totals for a student.
      school_open_incidents: 7,
      school_check_ins_today: 42,
    })

    expect(await screen.findByText('My status')).toBeInTheDocument()
    expect(screen.queryByText('School summary')).not.toBeInTheDocument()
    expect(tileValues()).not.toContain(7)
    expect(tileValues()).not.toContain(42)
  })

  it('shows school counts to a teacher without individual records', async () => {
    renderPage('teacher_staff', {
      role: 'teacher_staff',
      my_check_ins_today: 1,
      school_open_incidents: 3,
      school_unacknowledged_incidents: 1,
      school_open_reports: 2,
      school_check_ins_today: 30,
      school_need_help: 0,
    })

    expect(await screen.findByText('School summary')).toBeInTheDocument()
    expect(screen.getByText(/Counts only/)).toBeInTheDocument()
    expect(screen.getByText('open cases')).toBeInTheDocument()
  })

  it('shows the response links to a responder', async () => {
    renderPage('responder', {
      role: 'responder',
      school_open_incidents: 2,
      school_unacknowledged_incidents: 1,
      school_oldest_unacknowledged_minutes: 7,
    })

    expect(await screen.findByText('Response')).toBeInTheDocument()
    expect(screen.getByText(/Oldest unacknowledged case: 7 minutes/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Incident response queue' })).toBeInTheDocument()
  })

  it('shows account counts to an administrator', async () => {
    renderPage('administrator', {
      role: 'administrator',
      users_total: 42,
      users_by_role: { student: 38, administrator: 2, responder: 2 },
      audit_rows_30d: 120,
    })

    expect(await screen.findByText('Administration')).toBeInTheDocument()
    const section = screen.getByText('Administration').closest('section')
    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getByText(/student: 38/)).toBeInTheDocument()
  })

  it('states that weather is reviewer-only and points to the alerts feed', async () => {
    renderPage('student', { role: 'student' })
    expect(await screen.findByText('Not available yet')).toBeInTheDocument()
    expect(screen.getByText(/Weather advisory — shown to responders/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts')
  })

  it('shows an error when the counts call fails', async () => {
    renderPage('student', {}, { data: null, error: { message: 'counts failed' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('counts failed')
  })
})
