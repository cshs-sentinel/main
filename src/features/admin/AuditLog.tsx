import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface AuditRow {
  id: number
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  actor_id: string | null
  payload: Record<string, unknown> | null
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

const PAGE_SIZE = 50

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchResults = useCallback(async (): Promise<QueryResult> => {
    let query = supabase
      .from('audit_logs')
      .select('id, created_at, action, entity_type, entity_id, actor_id, payload')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (entityType) query = query.eq('entity_type', entityType)
    if (action) query = query.eq('action', action)
    const result = (await query) as QueryResult
    return result
  }, [entityType, action])

  const applyResults = useCallback((result: QueryResult) => {
    if (result.error) {
      setError(result.error.message)
    } else {
      setRows((result.data ?? []) as AuditRow[])
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

  const entityTypes = Array.from(new Set(rows.map((row) => row.entity_type))).sort()
  const actions = Array.from(new Set(rows.map((row) => row.action))).sort()

  return (
    <main id="main" className="admin-page">
      <h1>Audit log</h1>
      <p className="admin-subtitle">
        Append-only record of privileged actions in your school. Audit rows are never
        edited or deleted.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="loc-toolbar" role="group" aria-label="Filter the audit log">
        <label className="sr-only" htmlFor="audit-entity">
          Entity type
        </label>
        <select
          id="audit-entity"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        >
          <option value="">All entity types</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="audit-action">
          Action
        </label>
        <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p role="status">Loading audit entries…</p>
      ) : rows.length === 0 ? (
        <p className="loc-empty">No audit entries for this filter.</p>
      ) : (
        <ul className="loc-list">
          {rows.map((row) => (
            <li key={row.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">{row.action}</span>
                <span className="rep-status">{row.entity_type}</span>
              </div>
              <span className="loc-meta">
                {new Date(row.created_at).toLocaleString()} · actor{' '}
                {row.actor_id ? row.actor_id.slice(0, 8) : 'system'}
                {row.entity_id ? ` · ${String(row.entity_id).slice(0, 8)}` : ''}
              </span>
              {row.payload && Object.keys(row.payload).length > 0 && (
                <span className="loc-meta">{JSON.stringify(row.payload)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="loc-meta">
        Showing the most recent {PAGE_SIZE} entries. The log is append-only; it is not
        editable and not deletable.
      </p>
    </main>
  )
}
