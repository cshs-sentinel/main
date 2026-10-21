import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  DAY_NAMES,
  SCHEDULE_SELECT,
  WEEKDAY_ORDER,
  compareSchedules,
  formatEffective,
  formatTimeRange,
  todayLocal,
} from '../schedule/shared'
import type { ScheduleRow } from '../schedule/shared'

interface LocationOption {
  id: string
  name: string
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

interface FormValues {
  location_id: string
  day_of_week: string
  start_time: string
  end_time: string
  effective_from: string
  effective_until: string
  label: string
}

const EMPTY_FORM: FormValues = {
  location_id: '',
  day_of_week: '1',
  start_time: '',
  end_time: '',
  effective_from: '',
  effective_until: '',
  label: '',
}

function ScheduleForm({
  locations,
  onSubmit,
  onCancel,
}: {
  locations: LocationOption[]
  onSubmit: (values: FormValues) => Promise<string | null>
  onCancel: () => void
}) {
  const [values, setValues] = useState<FormValues>(() => ({
    ...EMPTY_FORM,
    effective_from: todayLocal(),
  }))
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!values.location_id) {
      setFormError('Location is required')
      return
    }
    if (!values.start_time || !values.end_time) {
      setFormError('Start and end times are required')
      return
    }
    if (values.end_time <= values.start_time) {
      setFormError('End time must be after start time')
      return
    }
    if (!values.effective_from) {
      setFormError('Effective from date is required')
      return
    }
    if (values.effective_until && values.effective_until < values.effective_from) {
      setFormError('Effective until must be on or after effective from')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const saveError = await onSubmit(values)
      if (saveError) setFormError(saveError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="sched-form"
      aria-label="New schedule"
      onSubmit={(e) => void handleSubmit(e)}
    >
      <h2>New schedule</h2>
      {formError && (
        <p role="alert" className="auth-error">
          {formError}
        </p>
      )}

      <label htmlFor="sched-location">Location</label>
      <select
        id="sched-location"
        value={values.location_id}
        onChange={(e) => setValues((prev) => ({ ...prev, location_id: e.target.value }))}
      >
        <option value="">Select a location</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      <label htmlFor="sched-day">Day</label>
      <select
        id="sched-day"
        value={values.day_of_week}
        onChange={(e) => setValues((prev) => ({ ...prev, day_of_week: e.target.value }))}
      >
        {WEEKDAY_ORDER.map((day) => (
          <option key={day} value={day}>
            {DAY_NAMES[day]}
          </option>
        ))}
      </select>

      <label htmlFor="sched-start">Start time</label>
      <input
        id="sched-start"
        type="time"
        value={values.start_time}
        onChange={(e) => setValues((prev) => ({ ...prev, start_time: e.target.value }))}
      />

      <label htmlFor="sched-end">End time</label>
      <input
        id="sched-end"
        type="time"
        value={values.end_time}
        onChange={(e) => setValues((prev) => ({ ...prev, end_time: e.target.value }))}
      />

      <label htmlFor="sched-from">Effective from</label>
      <input
        id="sched-from"
        type="date"
        value={values.effective_from}
        onChange={(e) => setValues((prev) => ({ ...prev, effective_from: e.target.value }))}
      />

      <label htmlFor="sched-until">Effective until</label>
      <input
        id="sched-until"
        type="date"
        value={values.effective_until}
        onChange={(e) => setValues((prev) => ({ ...prev, effective_until: e.target.value }))}
      />

      <label htmlFor="sched-label">Label</label>
      <input
        id="sched-label"
        value={values.label}
        onChange={(e) => setValues((prev) => ({ ...prev, label: e.target.value }))}
      />

      <div className="loc-form-actions">
        <button type="submit" className="btn" disabled={submitting}>
          Create schedule
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function AdminSchedules() {
  const { schoolId } = useAuth()
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase.from('schedules').select(SCHEDULE_SELECT),
        supabase
          .from('locations')
          .select('id, name')
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (scheduleResult: QueryResult, locationResult: QueryResult) => {
      if (scheduleResult.error) {
        setError(scheduleResult.error.message)
      } else {
        setSchedules((scheduleResult.data ?? []) as ScheduleRow[])
      }
      if (locationResult.error) {
        setError(locationResult.error.message)
      } else {
        setLocations((locationResult.data ?? []) as LocationOption[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then(([scheduleResult, locationResult]) => {
      if (cancelled) return
      applyResults(scheduleResult, locationResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [scheduleResult, locationResult] = await fetchResults()
    applyResults(scheduleResult, locationResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  const ordered = useMemo(
    () => [...schedules].sort(compareSchedules),
    [schedules],
  )

  const locationName = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations],
  )

  async function handleCreate(values: FormValues): Promise<string | null> {
    if (!schoolId) return 'No school is assigned to this account.'
    setError('')
    const { error: insertError } = await supabase.from('schedules').insert({
      school_id: schoolId,
      location_id: values.location_id,
      day_of_week: Number(values.day_of_week),
      start_time: values.start_time,
      end_time: values.end_time,
      effective_from: values.effective_from,
      effective_until: values.effective_until || null,
      label: values.label.trim() || null,
      status: 'active',
    })
    if (insertError) return insertError.message
    setCreating(false)
    await load()
    return null
  }

  async function handleToggle(row: ScheduleRow) {
    setError('')
    const { error: toggleError } = await supabase
      .from('schedules')
      .update({ status: row.status === 'active' ? 'inactive' : 'active' })
      .eq('id', row.id)
    if (toggleError) {
      setError(toggleError.message)
      return
    }
    await load()
  }

  return (
    <main id="main" className="admin-page">
      <h1>Schedule Management</h1>
      <p className="admin-subtitle">
        Define when a location is expected to be in use. Overlapping active times
        for the same day and location are rejected by the server.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading schedules…</p>
      ) : (
        <>
          <div className="loc-toolbar">
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              Add schedule
            </button>
          </div>

          {creating && (
            <ScheduleForm
              locations={locations}
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
            />
          )}

          {ordered.length === 0 ? (
            <p className="loc-empty">
              No schedules yet. Add the first recurring time slot.
            </p>
          ) : (
            <ul className="loc-list">
              {ordered.map((row) => (
                <li key={row.id} className="loc-row">
                  <div className="loc-head">
                    <span className="loc-name">
                      {DAY_NAMES[row.day_of_week]} {formatTimeRange(row)}
                    </span>
                    <span className="loc-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleToggle(row)}
                      >
                        {row.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </span>
                  </div>
                  <span className="loc-meta">
                    {row.locations?.name ?? locationName.get(row.location_id) ?? 'Unknown location'}
                    {row.label ? ` · ${row.label}` : ''} · {formatEffective(row)} ·{' '}
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
