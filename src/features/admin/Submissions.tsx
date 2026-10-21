import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  SUBMISSION_KINDS,
  SUBMISSION_SELECT,
  formatWhen,
  kindLabel,
  statusLabel,
  stressLabel,
  subTypeLabel,
} from '../submissions/shared'
import type { SubmissionRow } from '../submissions/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

interface ProfileRow {
  id: string
  display_name: string | null
}

type Filter = 'all' | 'sentiment' | 'incident_hazard' | 'observation'

export default function Submissions() {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const fetchResults = useCallback(async (): Promise<{
    submissions: QueryResult
    profiles: QueryResult
  }> => {
    const [submissionResult, profileResult] = await Promise.all([
      supabase
        .from('submissions')
        .select(SUBMISSION_SELECT)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name'),
    ])
    return { submissions: submissionResult as QueryResult, profiles: profileResult as QueryResult }
  }, [])

  const applyResults = useCallback(
    (results: { submissions: QueryResult; profiles: QueryResult }) => {
      if (results.submissions.error) {
        setError(results.submissions.error.message)
      } else {
        setSubmissions((results.submissions.data ?? []) as SubmissionRow[])
      }
      if (results.profiles.error) {
        setError(results.profiles.error.message)
      } else {
        setProfiles((results.profiles.data ?? []) as ProfileRow[])
      }
      setLoading(false)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then((results) => {
      if (cancelled) return
      applyResults(results)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    applyResults(await fetchResults())
  }, [fetchResults, applyResults])

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const profile of profiles) {
      map.set(profile.id, profile.display_name ?? profile.id.slice(0, 8))
    }
    return map
  }, [profiles])

  const visible = useMemo(
    () => (filter === 'all' ? submissions : submissions.filter((row) => row.kind === filter)),
    [submissions, filter],
  )

  async function changeStatus(row: SubmissionRow, status: 'acknowledged' | 'resolved') {
    setError('')
    setBusyId(row.id)
    try {
      const { error: updateError } = await supabase
        .from('submissions')
        .update({
          status,
          acknowledged_at: status === 'acknowledged' ? new Date().toISOString() : undefined,
          resolved_at: status === 'resolved' ? new Date().toISOString() : undefined,
        })
        .eq('id', row.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      await load()
    } finally {
      setBusyId('')
    }
  }

  return (
    <main id="main" className="admin-page">
      <h1>Submissions</h1>
      <p className="admin-subtitle">
        Information sent by people in your school. Review it, record what was done,
        and close what is finished.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="loc-toolbar" role="group" aria-label="Filter submissions">
        <button
          type="button"
          className={filter === 'all' ? 'btn' : 'btn btn-secondary'}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {SUBMISSION_KINDS.filter((kind) => kind.value !== 'emergency').map((kind) => (
          <button
            key={kind.value}
            type="button"
            className={filter === kind.value ? 'btn' : 'btn btn-secondary'}
            onClick={() => setFilter(kind.value as Filter)}
          >
            {kind.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status">Loading submissions…</p>
      ) : visible.length === 0 ? (
        <p className="loc-empty">Nothing submitted in this view.</p>
      ) : (
        <ul className="loc-list">
          {visible.map((row) => (
            <li key={row.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">
                  {kindLabel(row.kind)} · {subTypeLabel(row.kind, row.sub_type)}
                </span>
                <span className={`rep-status rep-status-${row.status}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
              <span className="loc-meta">
                from {nameById.get(row.submitted_by) ?? 'a member of the school'} ·{' '}
                {formatWhen(row.created_at)}
                {row.stress_level !== null
                  ? ` · stress ${row.stress_level} (${stressLabel(row.stress_level)})`
                  : ''}
              </span>
              <p className="rep-description">{row.message}</p>
              {row.resolution_note && (
                <span className="loc-meta">Recorded action: {row.resolution_note}</span>
              )}
              <div className="loc-actions">
                {row.status === 'new' && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === row.id}
                    onClick={() => void changeStatus(row, 'acknowledged')}
                  >
                    Acknowledge
                  </button>
                )}
                {row.status !== 'resolved' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === row.id}
                    onClick={() => void changeStatus(row, 'resolved')}
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
