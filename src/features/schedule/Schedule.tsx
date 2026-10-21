import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  DAY_NAMES,
  SCHEDULE_SELECT,
  WEEKDAY_ORDER,
  compareSchedules,
  formatEffective,
  formatTimeRange,
} from './shared'
import type { ScheduleRow } from './shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export default function Schedule() {
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchResults = useCallback(
    () =>
      supabase
        .from('schedules')
        .select(SCHEDULE_SELECT)
        .eq('status', 'active')
        .order('day_of_week', { ascending: true }),
    [],
  )

  const applyResult = useCallback((result: QueryResult) => {
    if (result.error) {
      setError(result.error.message)
    } else {
      setRows((result.data ?? []) as ScheduleRow[])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchResults().then((result) => {
      if (cancelled) return
      applyResult(result)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResult])

  const grouped = WEEKDAY_ORDER.map((day) => ({
    day,
    rows: rows.filter((row) => row.day_of_week === day).sort(compareSchedules),
  })).filter((group) => group.rows.length > 0)

  return (
    <main className="admin-page sched-page">
      <h1>My Schedule</h1>
      <p className="sched-notice" role="note">
        Schedule-derived expectations only. These times show where you are
        expected to be — they are not verified or observed locations, and a
        scheduled room is not proof of anyone&apos;s actual location.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading schedule…</p>
      ) : grouped.length === 0 ? (
        <p className="loc-empty">
          No schedule has been published for your school yet.
        </p>
      ) : (
        grouped.map((group) => (
          <section key={group.day} aria-label={DAY_NAMES[group.day]} className="sched-day">
            <h2 className="admin-section-title">{DAY_NAMES[group.day]}</h2>
            <ul className="sched-list">
              {group.rows.map((row) => (
                <li key={row.id} className="sched-row">
                  <span className="sched-time">{formatTimeRange(row)}</span>
                  <span className="sched-location">
                    {row.locations?.name ?? 'Unknown location'}
                  </span>
                  {row.label && <span className="sched-label">{row.label}</span>}
                  <span className="sched-tag">schedule-derived</span>
                  <span className="sched-effective">{formatEffective(row)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
