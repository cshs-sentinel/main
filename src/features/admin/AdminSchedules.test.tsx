import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import AdminSchedules from './AdminSchedules'
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
  },
}))

const SCHEDULES = [
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
    id: 's2',
    location_id: 'l2',
    day_of_week: 3,
    start_time: '09:30:00',
    end_time: '10:30:00',
    effective_from: '2026-01-05',
    effective_until: '2026-06-30',
    label: null,
    status: 'inactive',
    locations: { name: 'Gym' },
  },
]

const LOCATIONS = [
  { id: 'l1', name: 'Room 101' },
  { id: 'l2', name: 'Gym' },
]

const mockUser = { id: 'admin-1' } as User

function renderPage() {
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role: 'administrator',
    schoolId: SCHOOL_ID,
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <AdminSchedules />
    </AuthContext.Provider>,
  )
}

function scheduleInserts() {
  return state.calls.filter((c) => c.table === 'schedules' && c.op === 'insert')
}

function fillValidSchedule() {
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } })
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00' } })
}

describe('AdminSchedules', () => {
  beforeEach(() => {
    state.calls.length = 0
    state.results = {
      'schedules:select': { data: SCHEDULES, error: null },
      'locations:select': { data: LOCATIONS, error: null },
    }
  })

  it('loads and lists schedules with location names', async () => {
    renderPage()
    expect(await screen.findByText(/Period 1/)).toBeInTheDocument()
    expect(screen.getByText(/^Monday/)).toBeInTheDocument()
    expect(screen.getByText(/^Wednesday/)).toBeInTheDocument()
    expect(screen.getByText(/Room 101/)).toBeInTheDocument()
    expect(screen.getByText(/Gym/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no schedules', async () => {
    state.results['schedules:select'] = { data: [], error: null }
    renderPage()
    expect(await screen.findByText(/No schedules yet/)).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['schedules:select'] = { data: null, error: { message: 'permission denied' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  })

  it('creates a schedule with the form defaults', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Period 1/)

    await user.click(screen.getByRole('button', { name: 'Add schedule' }))
    await user.selectOptions(screen.getByLabelText('Location'), 'l1')
    fillValidSchedule()
    await user.type(screen.getByLabelText('Label'), 'Math')
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => expect(scheduleInserts()).toHaveLength(1))
    expect(scheduleInserts()[0].payload).toEqual({
      school_id: SCHOOL_ID,
      location_id: 'l1',
      day_of_week: 1,
      start_time: '10:00',
      end_time: '11:00',
      effective_from: expect.any(String),
      effective_until: null,
      label: 'Math',
      status: 'active',
    })
  })

  it('requires a location before creating', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Period 1/)

    await user.click(screen.getByRole('button', { name: 'Add schedule' }))
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Location is required')
    expect(scheduleInserts()).toHaveLength(0)
  })

  it('rejects an end time that is not after the start time', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Period 1/)

    await user.click(screen.getByRole('button', { name: 'Add schedule' }))
    await user.selectOptions(screen.getByLabelText('Location'), 'l1')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:00' } })
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'End time must be after start time',
    )
    expect(scheduleInserts()).toHaveLength(0)
  })

  it('rejects an effective range that ends before it starts', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Period 1/)

    await user.click(screen.getByRole('button', { name: 'Add schedule' }))
    await user.selectOptions(screen.getByLabelText('Location'), 'l1')
    fillValidSchedule()
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-06-01' },
    })
    fireEvent.change(screen.getByLabelText('Effective until'), {
      target: { value: '2026-05-01' },
    })
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Effective until must be on or after effective from',
    )
    expect(scheduleInserts()).toHaveLength(0)
  })

  it('surfaces server conflict errors such as an overlap', async () => {
    const user = userEvent.setup()
    state.results['schedules:insert'] = {
      data: null,
      error: { message: 'overlaps an existing active schedule for this location and day' },
    }
    renderPage()
    await screen.findByText(/Period 1/)

    await user.click(screen.getByRole('button', { name: 'Add schedule' }))
    await user.selectOptions(screen.getByLabelText('Location'), 'l1')
    fillValidSchedule()
    await user.click(screen.getByRole('button', { name: 'Create schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'overlaps an existing active schedule',
    )
  })

  it('toggles a schedule inactive', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Period 1/)

    const row = screen.getByText(/Period 1/).closest('li')
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      const call = state.calls.find(
        (c) => c.table === 'schedules' && c.op === 'update',
      )
      expect(call?.payload).toEqual({ status: 'inactive' })
      expect(call?.filters).toEqual({ id: 's1' })
    })
  })
})
