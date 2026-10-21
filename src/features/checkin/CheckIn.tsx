import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { formatReportDate } from '../reports/shared'
import type { LocationOption } from '../reports/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

interface CheckInRow {
  id: string
  location_source: string
  period: string | null
  status: string
  checked_in_at: string
  locations?: { name: string } | null
}

const SOURCE_LABELS: Record<string, string> = {
  self_selected: 'Self-selected',
  schedule_derived: 'Schedule-derived (unverified)',
  staff_verified: 'Staff-verified',
}

export default function CheckIn() {
  const { schoolId } = useAuth()
  const [checkIns, setCheckIns] = useState<CheckInRow[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [locationId, setLocationId] = useState('')
  const [source, setSource] = useState('self_selected')
  const [period, setPeriod] = useState('')

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('check_ins')
          .select('id, location_source, period, status, checked_in_at, locations(name)')
          .order('checked_in_at', { ascending: false })
          .limit(20),
        supabase
          .from('locations')
          .select('id, name')
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (checkInResult: QueryResult, locationResult: QueryResult) => {
      if (checkInResult.error) {
        setError(checkInResult.error.message)
      } else {
        setCheckIns((checkInResult.data ?? []) as CheckInRow[])
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
    void fetchResults().then(([checkInResult, locationResult]) => {
      if (cancelled) return
      applyResults(checkInResult, locationResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [checkInResult, locationResult] = await fetchResults()
    applyResults(checkInResult, locationResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  async function record(status: 'safe' | 'need_help') {
    if (!schoolId) {
      setError('No school is assigned to this account.')
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { error: insertError } = await supabase.from('check_ins').insert({
        school_id: schoolId,
        location_source: source,
        location_id: locationId || null,
        period: period.trim() || null,
        status,
      })
      if (insertError) {
        setError(insertError.message)
        return
      }
      setNotice(
        status === 'safe'
          ? 'Check-in recorded. Thank you.'
          : 'Recorded that you need help. Use SOS for an emergency.',
      )
      setPeriod('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="admin-page">
      <h1>Safety check-in</h1>
      <p className="admin-subtitle">
        A check-in records what you told us. It is not a verified location — staff
        confirm locations separately.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rep-notice">
          {notice}
        </p>
      )}

      <form className="rep-form" aria-label="Record a check-in">
        <h2>Where are you?</h2>

        <label htmlFor="chk-source">How was this location chosen?</label>
        <select id="chk-source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="self_selected">I chose it myself</option>
          <option value="schedule_derived">From my timetable (not verified)</option>
          <option value="staff_verified">Staff confirmed it</option>
        </select>

        <label htmlFor="chk-location">Location (optional)</label>
        <select id="chk-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">No specific location</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>

        <label htmlFor="chk-period">Period label (optional)</label>
        <input
          id="chk-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="e.g. Period 3"
        />

        <div className="loc-form-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void record('safe')}>
            I am safe
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void record('need_help')}
          >
            I need help
          </button>
        </div>
      </form>

      {loading ? (
        <p role="status">Loading check-ins…</p>
      ) : checkIns.length === 0 ? (
        <p className="loc-empty">No check-ins recorded yet.</p>
      ) : (
        <ul className="loc-list">
          {checkIns.map((checkIn) => (
            <li key={checkIn.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">
                  {checkIn.status === 'need_help' ? 'Needs help' : 'Safe'}
                </span>
                <span className={`rep-status rep-status-${checkIn.status === 'need_help' ? 'open' : 'resolved'}`}>
                  {SOURCE_LABELS[checkIn.location_source] ?? checkIn.location_source}
                </span>
              </div>
              <span className="loc-meta">
                {checkIn.locations?.name ?? 'No specific location'}
                {checkIn.period ? ` · ${checkIn.period}` : ''} ·{' '}
                {formatReportDate(checkIn.checked_in_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
