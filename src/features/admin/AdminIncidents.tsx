import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  INCIDENT_SELECT,
  INCIDENT_STATUSES,
  categoryLabel,
  formatTimestamp,
  statusLabel,
} from '../incidents/shared'
import type { HistoryRow, IncidentRow, NoteRow } from '../incidents/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

type Filter = 'all' | 'open' | 'closed'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

export default function AdminIncidents() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [busyId, setBusyId] = useState('')
  const [noteBody, setNoteBody] = useState<Record<string, string>>({})
  const [resolution, setResolution] = useState<Record<string, string>>({})

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('incidents')
          .select(INCIDENT_SELECT)
          .order('created_at', { ascending: false }),
        supabase
          .from('incident_status_history')
          .select('id, incident_id, from_status, to_status, actor_id, note, created_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('incident_notes')
          .select('id, incident_id, author_id, body, created_at')
          .order('created_at', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (incidentResult: QueryResult, historyResult: QueryResult, noteResult: QueryResult) => {
      if (incidentResult.error) {
        setError(incidentResult.error.message)
      } else {
        setIncidents((incidentResult.data ?? []) as IncidentRow[])
      }
      if (historyResult.error) {
        setError(historyResult.error.message)
      } else {
        setHistory((historyResult.data ?? []) as HistoryRow[])
      }
      if (noteResult.error) {
        setError(noteResult.error.message ?? 'Could not load notes')
      } else {
        setNotes((noteResult.data ?? []) as NoteRow[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then(([incidentResult, historyResult, noteResult]) => {
      if (cancelled) return
      applyResults(incidentResult, historyResult, noteResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [incidentResult, historyResult, noteResult] = await fetchResults()
    applyResults(incidentResult, historyResult, noteResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  const historyByIncident = useMemo(() => {
    const map = new Map<string, HistoryRow[]>()
    for (const row of history) {
      const list = map.get(row.incident_id) ?? []
      list.push(row)
      map.set(row.incident_id, list)
    }
    return map
  }, [history])

  const notesByIncident = useMemo(() => {
    const map = new Map<string, NoteRow[]>()
    for (const row of notes) {
      const list = map.get(row.incident_id) ?? []
      list.push(row)
      map.set(row.incident_id, list)
    }
    return map
  }, [notes])

  const visible = useMemo(() => {
    if (filter === 'all') return incidents
    if (filter === 'open') {
      return incidents.filter((incident) =>
        ['new', 'acknowledged', 'assigned', 'in_progress'].includes(incident.status),
      )
    }
    return incidents.filter((incident) =>
      ['resolved', 'closed', 'cancelled'].includes(incident.status),
    )
  }, [incidents, filter])

  async function transition(incident: IncidentRow, status: string, note: string | null) {
    setError('')
    setBusyId(incident.id)
    try {
      const { error: rpcError } = await supabase.rpc('transition_incident', {
        incident_id: incident.id,
        new_status: status,
        note,
      })
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      await load()
    } finally {
      setBusyId('')
    }
  }

  async function addNote(incident: IncidentRow) {
    const body = (noteBody[incident.id] ?? '').trim()
    if (!body) {
      setError('Write a note before adding it')
      return
    }
    setError('')
    setBusyId(incident.id)
    try {
      const { error: noteError } = await supabase.from('incident_notes').insert({
        incident_id: incident.id,
        body,
      })
      if (noteError) {
        setError(noteError.message)
        return
      }
      setNoteBody((previous) => ({ ...previous, [incident.id]: '' }))
      await load()
    } finally {
      setBusyId('')
    }
  }

  return (
    <main id="main" className="admin-page">
      <h1>Incident response</h1>
      <p className="admin-subtitle">
        Cases raised by people in your school. Acknowledge, assign, work the case,
        then resolve and close it. Every step is recorded.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="loc-toolbar" role="group" aria-label="Filter cases">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === filter ? 'btn' : 'btn btn-secondary'}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status">Loading cases…</p>
      ) : visible.length === 0 ? (
        <p className="loc-empty">No cases in this view.</p>
      ) : (
        <ul className="loc-list">
          {visible.map((incident) => {
            const timeline = historyByIncident.get(incident.id) ?? []
            const caseNotes = notesByIncident.get(incident.id) ?? []
            return (
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

                <div className="loc-actions">
                  {incident.status === 'new' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === incident.id}
                      onClick={() => void transition(incident, 'acknowledged', null)}
                    >
                      Acknowledge
                    </button>
                  )}
                  {incident.status === 'acknowledged' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === incident.id}
                      onClick={() => void transition(incident, 'assigned', null)}
                    >
                      Assign to me
                    </button>
                  )}
                  {incident.status === 'assigned' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === incident.id}
                      onClick={() => void transition(incident, 'in_progress', null)}
                    >
                      Start work
                    </button>
                  )}
                  {incident.status === 'in_progress' && (
                    <>
                      <label className="sr-only" htmlFor={`resolution-${incident.id}`}>
                        Resolution note
                      </label>
                      <input
                        id={`resolution-${incident.id}`}
                        value={resolution[incident.id] ?? ''}
                        onChange={(e) =>
                          setResolution((previous) => ({
                            ...previous,
                            [incident.id]: e.target.value,
                          }))
                        }
                        placeholder="What was done?"
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === incident.id}
                        onClick={() =>
                          void transition(
                            incident,
                            'resolved',
                            (resolution[incident.id] ?? '').trim() || null,
                          )
                        }
                      >
                        Resolve
                      </button>
                    </>
                  )}
                  {incident.status === 'resolved' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === incident.id}
                      onClick={() => void transition(incident, 'closed', null)}
                    >
                      Close case
                    </button>
                  )}
                </div>

                {timeline.length > 0 && (
                  <div className="inc-timeline">
                    <h3>Timeline</h3>
                    <ul>
                      {timeline.map((row) => (
                        <li key={row.id}>
                          {formatTimestamp(row.created_at)} — {statusLabel(row.to_status)}
                          {row.note ? `: ${row.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {caseNotes.length > 0 && (
                  <div className="inc-timeline">
                    <h3>Response notes</h3>
                    <ul>
                      {caseNotes.map((row) => (
                        <li key={row.id}>
                          {formatTimestamp(row.created_at)} — {row.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="loc-form-actions">
                  <label className="sr-only" htmlFor={`note-${incident.id}`}>
                    Add a response note
                  </label>
                  <input
                    id={`note-${incident.id}`}
                    value={noteBody[incident.id] ?? ''}
                    onChange={(e) =>
                      setNoteBody((previous) => ({ ...previous, [incident.id]: e.target.value }))
                    }
                    placeholder="Add a response note"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === incident.id}
                    onClick={() => void addNote(incident)}
                  >
                    Add note
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="loc-meta">
        Workflow: {INCIDENT_STATUSES.join(' → ')}. A cancelled case keeps its full
        history.
      </p>
    </main>
  )
}
