import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Submit from './Submit'
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

function renderPage() {
  const value: AuthContextValue = {
    user: { id: 'student-1' } as never,
    session: null,
    role: 'student',
    schoolId: SCHOOL_ID,
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <Submit />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

function insertCalls() {
  return state.calls.filter((call) => call.table === 'submissions' && call.op === 'insert')
}

describe('Submit', () => {
  beforeEach(() => {
    state.calls = []
    state.results = {
      'locations:select': { data: [{ id: 'l1', name: 'Demo Room 101' }], error: null },
      'submissions:insert': { data: { id: 's1' }, error: null },
    }
  })

  it('offers the four data categories the school defined', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Sentiment & Feelings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Incidents & Hazards' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emergencies' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Other Observations' })).toBeInTheDocument()
  })

  it('sends a sentiment submission with the feeling and stress level', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Sentiment & Feelings' })

    await user.selectOptions(screen.getByLabelText('How are you feeling?'), 'stressed')
    await user.selectOptions(screen.getByLabelText(/How stressed do you feel/), '5')
    fireEvent.change(screen.getByLabelText('Tell us what happened'), {
      target: { value: 'Exams are piling up and I cannot sleep.' },
    })
    await user.click(screen.getByRole('button', { name: 'Send to school staff' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      school_id: SCHOOL_ID,
      kind: 'sentiment',
      sub_type: 'stressed',
      emotion: 'stressed',
      stress_level: 5,
    })
  })

  it('sends an incident/hazard submission with a type and location', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Incidents & Hazards' })

    await user.click(screen.getByRole('button', { name: 'Incidents & Hazards' }))
    await user.selectOptions(screen.getByLabelText('Type'), 'bullying')
    await user.selectOptions(screen.getByLabelText(/Where did this happen/), 'l1')
    fireEvent.change(screen.getByLabelText('Tell us what happened'), {
      target: { value: 'A student is being bullied near the canteen.' },
    })
    await user.click(screen.getByRole('button', { name: 'Send to school staff' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      kind: 'incident_hazard',
      sub_type: 'bullying',
      location_id: 'l1',
      stress_level: null,
    })
  })

  it('sends an observation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Other Observations' })

    await user.click(screen.getByRole('button', { name: 'Other Observations' }))
    await user.selectOptions(screen.getByLabelText('Type'), 'suggestion')
    fireEvent.change(screen.getByLabelText('Tell us what happened'), {
      target: { value: 'Please add shade over the basketball court.' },
    })
    await user.click(screen.getByRole('button', { name: 'Send to school staff' }))

    await waitFor(() => expect(insertCalls()).toHaveLength(1))
    expect(insertCalls()[0].payload).toMatchObject({
      kind: 'observation',
      sub_type: 'suggestion',
    })
  })

  it('sends emergencies to the SOS flow instead of the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Emergencies' })

    await user.click(screen.getByRole('button', { name: 'Emergencies' }))
    expect(screen.getByRole('button', { name: 'Go to SOS' })).toBeInTheDocument()
    expect(insertCalls()).toHaveLength(0)
  })

  it('refuses a message that is too short', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Sentiment & Feelings' })

    fireEvent.change(screen.getByLabelText('Tell us what happened'), { target: { value: 'x' } })
    await user.click(screen.getByRole('button', { name: 'Send to school staff' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('write a little more')
    expect(insertCalls()).toHaveLength(0)
  })

  it('confirms that the information was sent', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Sentiment & Feelings' })

    fireEvent.change(screen.getByLabelText('Tell us what happened'), {
      target: { value: 'I am finding the schoolwork hard this term.' },
    })
    await user.click(screen.getByRole('button', { name: 'Send to school staff' }))

    expect(await screen.findByRole('status')).toHaveTextContent('sent to the school staff')
  })

  it('shows no list of submissions (students can only send)', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Sentiment & Feelings' })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(state.calls.some((call) => call.table === 'submissions' && call.op === 'select')).toBe(
      false,
    )
  })
})
