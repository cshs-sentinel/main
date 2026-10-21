import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter } from 'react-router-dom'
import Alerts from './Alerts'
import { AuthContext } from '../auth/AuthContext'
import type { AuthContextValue, AppRole } from '../auth/AuthContext'

const { state, makeBuilder } = vi.hoisted(() => {
  interface CallRecord {
    table: string
    op: string
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

const PUBLISHED_ALERT = {
  id: 'a1',
  title: 'Drill on Friday',
  body: 'Evacuation drill at 10:00, please follow staff instructions.',
  severity: 'advisory',
  status: 'published',
  target_scope: 'all',
  target_role: null,
  created_by: 'admin-1',
  approved_at: '2026-06-01T09:00:00Z',
  published_at: '2026-06-01T10:00:00Z',
  cancelled_at: null,
  cancel_reason: null,
  supersedes_id: null,
  version: 1,
  created_at: '2026-06-01T08:00:00Z',
  incident_id: null,
}

const mockUser = { id: 'student-1' } as User

function renderPage(role: AppRole) {
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
        <Alerts />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('Alerts', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'alerts:select': { data: [PUBLISHED_ALERT], error: null },
      'incident_notifications:select': { data: [], error: null },
    }
  })

  it('lists published alerts with severity and audience', async () => {
    renderPage('student')
    expect(await screen.findByText('Drill on Friday')).toBeInTheDocument()
    expect(screen.getByText('Advisory')).toBeInTheDocument()
    expect(screen.getByText(/Everyone in the school/)).toBeInTheDocument()
  })

  it('states that no SMS or email is sent', async () => {
    renderPage('student')
    expect(await screen.findByText(/no SMS, email or push message is sent/i)).toBeInTheDocument()
  })

  it('only requests published alerts', async () => {
    renderPage('student')
    await screen.findByText('Drill on Friday')
    const alertCall = state.calls.find((call) => call.table === 'alerts')
    expect(alertCall?.filters).toMatchObject({ status: 'published' })
  })

  it('does not read case notifications for a student', async () => {
    renderPage('student')
    await screen.findByText('Drill on Friday')
    expect(
      state.calls.some((call) => call.table === 'incident_notifications'),
    ).toBe(false)
  })

  it('shows new-case notifications to a responder', async () => {
    state.results['incident_notifications:select'] = {
      data: [
        {
          id: 'n1',
          case_ref: 'SNT-2026-0009',
          title: 'New case SNT-2026-0009',
          body: 'Smoke on the second floor',
          created_at: '2026-06-01T11:00:00Z',
        },
      ],
      error: null,
    }
    renderPage('responder')
    expect(await screen.findByText('SNT-2026-0009')).toBeInTheDocument()
    expect(screen.getByText(/not official announcements/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no published alerts', async () => {
    state.results['alerts:select'] = { data: [], error: null }
    renderPage('student')
    expect(await screen.findByText(/No published alerts for you right now/)).toBeInTheDocument()
  })

  it('shows an error when the feed fails to load', async () => {
    state.results['alerts:select'] = { data: null, error: { message: 'alerts failed' } }
    renderPage('student')
    expect(await screen.findByRole('alert')).toHaveTextContent('alerts failed')
  })

  it('links a responder to the alert console', async () => {
    renderPage('responder')
    const link = await screen.findByRole('link', { name: /Manage alerts/ })
    expect(link).toHaveAttribute('href', '/admin/alerts')
  })
})
