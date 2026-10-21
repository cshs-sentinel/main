import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SELECT,
  MAX_DESCRIPTION,
  MIN_DESCRIPTION,
  categoryLabel,
  formatTimestamp,
  isOpen,
  statusLabel,
} from './shared'
import type { IncidentRow } from './shared'
import type { LocationOption } from '../reports/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export default function Sos() {
  const { schoolId } = useAuth()
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [caseRef, setCaseRef] = useState('')
  const [composing, setComposing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0].value)
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('incidents')
          .select(INCIDENT_SELECT)
          .order('created_at', { ascending: false }),
        supabase
          .from('locations')
          .select('id, name')
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (incidentResult: QueryResult, locationResult: QueryResult) => {
      if (incidentResult.error) {
        setError(incidentResult.error.message)
      } else {
        setIncidents((incidentResult.data ?? []) as IncidentRow[])
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
    void fetchResults().then(([incidentResult, locationResult]) => {
      if (cancelled) return
      applyResults(incidentResult, locationResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [incidentResult, locationResult] = await fetchResults()
    applyResults(incidentResult, locationResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!schoolId) {
      setFormError('No school is assigned to this account.')
      return
    }
    const trimmed = description.trim()
    if (trimmed.length < MIN_DESCRIPTION) {
      setFormError(`Description must be at least ${MIN_DESCRIPTION} characters`)
      return
    }
    if (trimmed.length > MAX_DESCRIPTION) {
      setFormError(`Description must be at most ${MAX_DESCRIPTION} characters`)
      return
    }
    setFormError('')
    setError('')
    setSubmitting(true)
    try {
      const { data, error: insertError } = await supabase
        .from('incidents')
        .insert({
          school_id: schoolId,
          category,
          description: trimmed,
          location_id: locationId || null,
        })
        .select('id, case_ref, status')
        .single()
      if (insertError) {
        setFormError(insertError.message)
        return
      }
      const created = data as { case_ref?: string } | null
      setCaseRef(created?.case_ref ?? '')
      setNotice('Your SOS was sent. Quote this case reference to responders.')
      setDescription('')
      setLocationId('')
      setComposing(false)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelIncident(incident: IncidentRow) {
    setError('')
    const { error: cancelError } = await supabase.rpc('transition_incident', {
      incident_id: incident.id,
      new_status: 'cancelled',
      note: 'Cancelled by the person who raised it',
    })
    if (cancelError) {
      setError(cancelError.message)
      return
    }
    await load()
  }

  return (
    <main id="main" className="admin-page">
      <h1>SOS</h1>
      <p className="admin-subtitle">
        Sends an emergency case to school responders. <strong>Call your local
        emergency number first if anyone is in immediate danger.</strong> This app
        does not replace emergency services.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {caseRef && (
        <p role="status" className="rep-notice">
          Case reference: <strong>{caseRef}</strong>
        </p>
      )}
      {notice && <p className="loc-meta">{notice}</p>}

      {!composing ? (
        <div className="loc-toolbar">
          <button type="button" className="btn btn-danger" onClick={() => setComposing(true)}>
            Send SOS
          </button>
        </div>
      ) : (
        <form className="rep-form" aria-label="Send an SOS" onSubmit={(e) => void handleSubmit(e)}>
          <h2>Send an SOS</h2>
          {formError && (
            <p role="alert" className="auth-error">
              {formError}
            </p>
          )}

          <label htmlFor="sos-category">Category</label>
          <select
            id="sos-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {INCIDENT_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="sos-description">What is happening?</label>
          <textarea
            id="sos-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the emergency and your location"
          />

          <label htmlFor="sos-location">Location (optional)</label>
          <select
            id="sos-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">No specific location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>

          <div className="loc-form-actions">
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? 'Sending…' : 'Confirm and send'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setComposing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <h2>My cases</h2>
      {loading ? (
        <p role="status">Loading cases…</p>
      ) : incidents.length === 0 ? (
        <p className="loc-empty">You have not raised any cases.</p>
      ) : (
        <ul className="loc-list">
          {incidents.map((incident) => (
            <li key={incident.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">{incident.case_ref}</span>
                <span className={`rep-status rep-status-${incident.status}`}>
                  {statusLabel(incident.status)}
                </span>
              </div>
              <span className="loc-meta">
                {categoryLabel(incident.category)} ·{' '}
                {incident.locations?.name ?? 'No specific location'} ·{' '}
                {formatTimestamp(incident.created_at)}
              </span>
              <p className="rep-description">{incident.description}</p>
              {incident.status === 'cancelled' && incident.cancelled_reason && (
                <span className="loc-meta">Cancelled: {incident.cancelled_reason}</span>
              )}
              {isOpen(incident.status) && (
                <div className="loc-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void cancelIncident(incident)}
                  >
                    Cancel case
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
