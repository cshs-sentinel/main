import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import Locations from './Locations'
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

const LOCATIONS = [
  {
    id: 'l1',
    parent_id: null,
    category_id: 'c-bld',
    name: 'Main Building',
    code: 'MB',
    description: null,
    environment: 'indoor',
    status: 'active',
    access_level: 'staff',
  },
  {
    id: 'l2',
    parent_id: 'l1',
    category_id: 'c-room',
    name: 'Room 101',
    code: 'R101',
    description: null,
    environment: 'indoor',
    status: 'active',
    access_level: 'staff',
  },
  {
    id: 'l3',
    parent_id: null,
    category_id: 'c-court',
    name: 'Basketball Court',
    code: null,
    description: null,
    environment: 'outdoor',
    status: 'active',
    access_level: 'public',
  },
  {
    id: 'l4',
    parent_id: 'l1',
    category_id: 'c-bld',
    name: 'Old Wing',
    code: null,
    description: null,
    environment: 'indoor',
    status: 'archived',
    access_level: 'staff',
  },
]

const CATEGORIES = [
  { id: 'c-bld', name: 'Building', environment: 'indoor', is_active: true },
  { id: 'c-room', name: 'Room', environment: 'indoor', is_active: true },
  { id: 'c-court', name: 'Court', environment: 'either', is_active: true },
  { id: 'c-park', name: 'Park', environment: 'outdoor', is_active: true },
  { id: 'c-old', name: 'Legacy Wing', environment: 'indoor', is_active: false },
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
      <Locations />
    </AuthContext.Provider>,
  )
}

function locationInserts() {
  return state.calls.filter((c) => c.table === 'locations' && c.op === 'insert')
}

describe('Locations', () => {
  beforeEach(() => {
    state.calls.length = 0
    state.results = {
      'locations:select': { data: LOCATIONS, error: null },
      'location_categories:select': { data: CATEGORIES, error: null },
    }
  })

  it('loads and lists active locations', async () => {
    renderPage()
    expect(await screen.findByText('Main Building')).toBeInTheDocument()
    expect(screen.getByText('Room 101')).toBeInTheDocument()
    expect(screen.getByText('Basketball Court')).toBeInTheDocument()
    expect(screen.queryByText('Old Wing')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no locations', async () => {
    state.results['locations:select'] = { data: [], error: null }
    renderPage()
    expect(await screen.findByText(/No locations yet/)).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['locations:select'] = { data: null, error: { message: 'RLS denied' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('RLS denied')
  })

  it('creates an outdoor top-level location without a parent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    await user.type(screen.getByLabelText('Name'), 'Open Court Two')
    await user.selectOptions(screen.getByLabelText('Category'), 'c-court')
    await user.selectOptions(screen.getByLabelText('Environment'), 'outdoor')
    await user.click(screen.getByRole('button', { name: 'Create location' }))

    await waitFor(() => expect(locationInserts()).toHaveLength(1))
    expect(locationInserts()[0].payload).toEqual({
      school_id: SCHOOL_ID,
      parent_id: null,
      category_id: 'c-court',
      name: 'Open Court Two',
      code: null,
      description: null,
      environment: 'outdoor',
      access_level: 'staff',
    })
  })

  it('creates an indoor location nested under a parent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    await user.type(screen.getByLabelText('Name'), 'Room 102')
    await user.selectOptions(screen.getByLabelText('Category'), 'c-room')
    await user.selectOptions(screen.getByLabelText('Parent location'), 'l1')
    await user.click(screen.getByRole('button', { name: 'Create location' }))

    await waitFor(() => expect(locationInserts()).toHaveLength(1))
    expect(locationInserts()[0].payload).toEqual({
      school_id: SCHOOL_ID,
      parent_id: 'l1',
      category_id: 'c-room',
      name: 'Room 102',
      code: null,
      description: null,
      environment: 'indoor',
      access_level: 'staff',
    })
  })

  it('requires a name before creating', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    await user.click(screen.getByRole('button', { name: 'Create location' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required')
    expect(locationInserts()).toHaveLength(0)
  })

  it('rejects a category that does not match the environment', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    await user.type(screen.getByLabelText('Name'), 'Pool House')
    await user.selectOptions(screen.getByLabelText('Category'), 'c-room')
    await user.selectOptions(screen.getByLabelText('Environment'), 'outdoor')
    await user.click(screen.getByRole('button', { name: 'Create location' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Category Room may not label an outdoor location',
    )
    expect(locationInserts()).toHaveLength(0)
  })

  it('surfaces server errors such as a duplicate code', async () => {
    const user = userEvent.setup()
    state.results['locations:insert'] = {
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "locations_school_code_unique"',
      },
    }
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    await user.type(screen.getByLabelText('Name'), 'Room 101 Copy')
    await user.type(screen.getByLabelText('Code'), 'R101')
    await user.selectOptions(screen.getByLabelText('Category'), 'c-room')
    await user.click(screen.getByRole('button', { name: 'Create location' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'duplicate key value violates unique constraint',
    )
  })

  it('archives a location only after inline confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    const row = screen.getByText('Room 101').closest('li')
    expect(row).not.toBeNull()
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Archive' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Archive “Room 101”?')
    await user.click(screen.getByRole('button', { name: 'Confirm archive' }))

    await waitFor(() => {
      const call = state.calls.find(
        (c) => c.table === 'locations' && c.op === 'update' && c.payload?.status === 'archived',
      )
      expect(call?.payload).toEqual({ status: 'archived' })
      expect(call?.filters).toEqual({ id: 'l2' })
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('excludes archived locations from parent options', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.click(screen.getByRole('button', { name: 'Add location' }))
    const parentSelect = screen.getByLabelText('Parent location')

    expect(
      within(parentSelect).queryByRole('option', { name: 'Old Wing' }),
    ).not.toBeInTheDocument()
    expect(
      within(parentSelect).getByRole('option', { name: 'Main Building' }),
    ).toBeInTheDocument()
  })

  it('excludes the edited location and its descendants from parent options', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    const row = screen.getByText('Main Building').closest('li')
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit' }))

    const parentSelect = screen.getByLabelText('Parent location')
    expect(
      within(parentSelect).queryByRole('option', { name: 'Main Building' }),
    ).not.toBeInTheDocument()
    expect(
      within(parentSelect).queryByRole('option', { name: 'Room 101' }),
    ).not.toBeInTheDocument()
    expect(
      within(parentSelect).getByRole('option', { name: 'Basketball Court' }),
    ).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Admin Block')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      const call = state.calls.find(
        (c) => c.table === 'locations' && c.op === 'update' && c.payload?.name === 'Admin Block',
      )
      expect(call?.payload).toEqual({
        parent_id: null,
        category_id: 'c-bld',
        name: 'Admin Block',
        code: 'MB',
        description: null,
        environment: 'indoor',
        access_level: 'staff',
      })
      expect(call?.payload).not.toHaveProperty('school_id')
      expect(call?.filters).toEqual({ id: 'l1' })
    })
  })

  it('toggles a category inactive', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    const deactivateButtons = screen.getAllByRole('button', { name: 'Deactivate' })
    await user.click(deactivateButtons[0])

    await waitFor(() => {
      const call = state.calls.find(
        (c) => c.table === 'location_categories' && c.op === 'update',
      )
      expect(call?.payload).toEqual({ is_active: false })
      expect(call?.filters).toEqual({ id: 'c-bld' })
    })
  })

  it('adds a new category', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Main Building')

    await user.type(screen.getByLabelText('Category name'), 'Shelter')
    await user.selectOptions(screen.getByLabelText('Category environment'), 'outdoor')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    await waitFor(() => {
      const call = state.calls.find(
        (c) => c.table === 'location_categories' && c.op === 'insert',
      )
      expect(call?.payload).toEqual({
        school_id: SCHOOL_ID,
        name: 'Shelter',
        environment: 'outdoor',
      })
    })
  })
})
