import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  SUBMISSION_KINDS,
  SUBMISSION_SUB_TYPES,
  kindLabel,
  subTypeLabel,
} from './shared'
import type { LocationOption } from './shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export default function Submit() {
  const { schoolId } = useAuth()
  const navigate = useNavigate()
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [kind, setKind] = useState<string>('sentiment')
  const [subType, setSubType] = useState<string>(SUBMISSION_SUB_TYPES.sentiment[0].value)
  const [message, setMessage] = useState('')
  const [stressLevel, setStressLevel] = useState('3')
  const [locationId, setLocationId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchResults = useCallback(async (): Promise<QueryResult> => {
    const result = (await supabase
      .from('locations')
      .select('id, name')
      .eq('status', 'active')
      .order('name', { ascending: true })) as QueryResult
    return result
  }, [])

  const applyResults = useCallback((result: QueryResult) => {
    if (result.error) {
      setError(result.error.message)
    } else {
      setLocations((result.data ?? []) as LocationOption[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchResults().then((result) => {
      if (cancelled) return
      applyResults(result)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  function chooseKind(next: string) {
    setKind(next)
    const options = SUBMISSION_SUB_TYPES[next]
    if (options) setSubType(options[0].value)
    setError('')
    setNotice('')
  }

  async function handleSubmit() {
    if (!schoolId) {
      setError('No school is assigned to this account.')
      return
    }
    if (message.trim().length < 3) {
      setError('Please write a little more so staff can understand it.')
      return
    }
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from('submissions').insert({
        school_id: schoolId,
        kind,
        sub_type: subType,
        message: message.trim(),
        emotion: kind === 'sentiment' ? subType : null,
        stress_level: kind === 'sentiment' ? Number(stressLevel) : null,
        location_id: kind === 'sentiment' ? null : locationId || null,
      })
      if (insertError) {
        setError(insertError.message)
        return
      }
      setMessage('')
      setNotice(
        'Thank you. This was sent to the school staff, who will review it.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main id="main" className="admin-page">
      <h1>Send information</h1>
      {loading ? (
        <p role="status">Loading…</p>
      ) : (
        <>
      <p className="admin-subtitle">
        Choose what you want to send to the school. Only school staff can read what
        is submitted here.
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

      <section className="dash-section">
        <h2>What do you want to send?</h2>
        <div className="loc-toolbar" role="group" aria-label="Category">
          {SUBMISSION_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === kind ? 'btn' : 'btn btn-secondary'}
              onClick={() => chooseKind(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="loc-meta">
          {SUBMISSION_KINDS.find((option) => option.value === kind)?.hint}
        </p>
      </section>

      {kind === 'emergency' ? (
        <section className="dash-section">
          <h2>Emergencies</h2>
          <p className="loc-meta">
            For fire, injury, accidents or an immediate threat, use the SOS button —
            it raises a case that responders are asked to pick up, with a case
            reference you can quote.
          </p>
          <div className="loc-form-actions">
            <button type="button" className="btn btn-danger" onClick={() => navigate('/sos')}>
              Go to SOS
            </button>
          </div>
        </section>
      ) : (
        <form className="rep-form" aria-label="Send information" onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
          <h2>{kindLabel(kind)}</h2>

          {kind === 'sentiment' ? (
            <>
              <label htmlFor="sub-emotion">How are you feeling?</label>
              <select id="sub-emotion" value={subType} onChange={(e) => setSubType(e.target.value)}>
                {SUBMISSION_SUB_TYPES.sentiment.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <label htmlFor="sub-stress">How stressed do you feel? (1 = very low, 5 = very high)</label>
              <select id="sub-stress" value={stressLevel} onChange={(e) => setStressLevel(e.target.value)}>
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="sub-type">Type</label>
              <select id="sub-type" value={subType} onChange={(e) => setSubType(e.target.value)}>
                {(SUBMISSION_SUB_TYPES[kind] ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <label htmlFor="sub-location">Where did this happen? (optional)</label>
              <select id="sub-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Not sure / no specific place</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label htmlFor="sub-message">Tell us what happened</label>
          <textarea
            id="sub-message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Anything that helps staff understand the situation"
          />

          <div className="loc-form-actions">
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send to school staff'}
            </button>
          </div>
        </form>
      )}

      <p className="loc-meta">
        Submissions are kept as a record and cannot be deleted. Staff review them and
        record what was done.
        {kind === 'sentiment' ? ' What you send here is only read by school staff.' : ''}
        {kind === 'sentiment' ? ` (${subTypeLabel('sentiment', subType)} recorded)` : ''}
      </p>
        </>
      )}
    </main>
  )
}
