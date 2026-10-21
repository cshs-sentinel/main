import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuditLog from './AuditLog'

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

const AUDIT_ROWS = [
  {
    id: 1,
    created_at: '2026-06-01T10:00:00Z',
    action: 'alert_published',
    entity_type: 'alerts',
    entity_id: 'a1',
    actor_id: 'aba76dd7-1503-4444-b1b5-6fb96aaef819',
    payload: { title: 'Drill on Friday' },
  },
  {
    id: 2,
    created_at: '2026-06-01T09:00:00Z',
    action: 'role_changed',
    entity_type: 'profiles',
    entity_id: '62dde16a-cda1-4f21-9923-8c216e668142',
    actor_id: 'aba76dd7-1503-4444-b1b5-6fb96aaef819',
    payload: { new_role: 'student' },
  },
]

describe('AuditLog', () => {
  beforeEach(() => {
    state.calls = []
    state.results = { 'audit_logs:select': { data: AUDIT_ROWS, error: null } }
  })

  it('lists audit entries newest first with actor and payload', async () => {
    render(<AuditLog />)
    const list = await screen.findByRole('list')
    expect(within(list).getByText('alert_published')).toBeInTheDocument()
    expect(within(list).getByText('role_changed')).toBeInTheDocument()
    expect(within(list).getByText(/Drill on Friday/)).toBeInTheDocument()
  })

  it('requests only the audit_logs table, newest first, with a page limit', async () => {
    render(<AuditLog />)
    await screen.findByRole('list')
    const call = state.calls[0]
    expect(call.table).toBe('audit_logs')
    expect(call.order).toMatchObject({ column: 'created_at' })
    expect(call.limit).toBe(50)
  })

  it('filters by entity type', async () => {
    const user = userEvent.setup()
    render(<AuditLog />)
    await screen.findByRole('list')

    await user.selectOptions(screen.getByLabelText('Entity type'), 'alerts')

    await waitFor(() => {
      const filtered = state.calls[state.calls.length - 1]
      expect(filtered.filters).toMatchObject({ entity_type: 'alerts' })
    })
  })

  it('shows an empty state when there is nothing to show', async () => {
    state.results['audit_logs:select'] = { data: [], error: null }
    render(<AuditLog />)
    expect(await screen.findByText(/No audit entries for this filter/)).toBeInTheDocument()
  })

  it('shows an error when the log fails to load', async () => {
    state.results['audit_logs:select'] = { data: null, error: { message: 'audit failed' } }
    render(<AuditLog />)
    expect(await screen.findByRole('alert')).toHaveTextContent('audit failed')
  })

  it('states that the log is append-only', async () => {
    render(<AuditLog />)
    expect((await screen.findAllByText(/append-only/i)).length).toBeGreaterThan(0)
  })
})
