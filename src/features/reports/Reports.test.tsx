import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import Reports from './Reports'
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

  interface StorageCall {
    op: string
    bucket: string
    path: string
  }

  const state = {
    calls: [] as CallRecord[],
    results: {} as Record<string, QueryResult>,
    storageCalls: [] as StorageCall[],
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
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          state.storageCalls.push({ op: 'upload', bucket, path })
          return { data: { path }, error: null }
        },
        createSignedUrl: async (path: string) => {
          state.storageCalls.push({ op: 'sign', bucket, path })
          return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
        },
        remove: async (paths: string[]) => {
          state.storageCalls.push({ op: 'remove', bucket, path: paths.join(',') })
          return { data: paths, error: null }
        },
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
      <Reports />
    </AuthContext.Provider>,
  )
}

function insertCalls() {
  return state.calls.filter((call) => call.table === 'hazard_reports' && call.op === 'insert')
}

describe('Reports', () => {
  beforeEach(() => {
    state.calls = []
    state.storageCalls = []
    state.results = {
      'hazard_reports:select': { data: REPORTS, error: null },
      'report_attachments:select': { data: [], error: null },
      'locations:select': { data: [{ id: 'l1', name: 'Science Lab' }], error: null },
      'hazard_reports:insert': { data: { id: 'r-new' }, error: null },
      'report_attachments:insert': { data: { id: 'a-new' }, error: null },
    }
  })

  it('lists the reports filed by the current user', async () => {
    renderPage()
    expect(await screen.findByText('Loose handrail by the science lab')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('Safety hazard')).toBeInTheDocument()
    expect(within(list).getByText('Open')).toBeInTheDocument()
    expect(within(list).getByText(/Science Lab/)).toBeInTheDocument()
  })

  it('shows an error when the fetch fails', async () => {
    state.results['hazard_reports:select'] = { data: null, error: { message: 'load failed' } }
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('load failed')
  })

  it('rejects a description that is too short', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'ab' } })
    await user.click(screen.getByRole('button', { name: 'File report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 3 characters')
    expect(insertCalls()).toHaveLength(0)
  })

  it('files a report for the current school', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Broken window in the gym' },
    })
    await user.selectOptions(screen.getByLabelText('Location (optional)'), 'l1')
    await user.click(screen.getByRole('button', { name: 'File report' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      school_id: SCHOOL_ID,
      category: 'facility_damage',
      description: 'Broken window in the gym',
      location_id: 'l1',
    })
  })

  it('rejects a photo that is not an allowed image type', async () => {
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Photo (optional)'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG or WebP')
  })

  it('uploads a photo to the private bucket and registers the attachment', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Loose handrail by the science lab')

    const file = new File(['image-bytes'], 'hazard.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Photo (optional)'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Broken window in the gym' },
    })
    await user.click(screen.getByRole('button', { name: 'File report' }))

    await waitFor(() => {
      expect(state.storageCalls.some((call) => call.op === 'upload')).toBe(true)
    })
    const upload = state.storageCalls.find((call) => call.op === 'upload')
    expect(upload?.bucket).toBe('report-photos')
    expect(upload?.path).toBe(`${SCHOOL_ID}/r-new/hazard.png`)
    const attachmentInsert = state.calls.find(
      (call) => call.table === 'report_attachments' && call.op === 'insert',
    )
    expect(attachmentInsert?.payload).toMatchObject({
      report_id: 'r-new',
      school_id: SCHOOL_ID,
      storage_path: `${SCHOOL_ID}/r-new/hazard.png`,
    })
  })
})
