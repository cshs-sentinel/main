import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  ALERT_SCOPES,
  ALERT_SEVERITIES,
  ALERT_SELECT,
  formatAlertTime,
  scopeLabel,
  severityLabel,
  statusLabel,
} from '../alerts/shared'
import type { AlertRow } from '../alerts/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

const ROLES = ['student', 'teacher_staff', 'responder', 'administrator'] as const

export default function AdminAlerts() {
  const { role, schoolId } = useAuth()
  const isAdmin = role === 'administrator'
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftSeverity, setDraftSeverity] = useState('advisory')
  const [draftScope, setDraftScope] = useState('all')
  const [draftRole, setDraftRole] = useState('teacher_staff')
  const [correctingId, setCorrectingId] = useState('')
  const [correctTitle, setCorrectTitle] = useState('')
  const [correctBody, setCorrectBody] = useState('')
  const [correctReason, setCorrectReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [cancellingId, setCancellingId] = useState('')

  const fetchResults = useCallback(async (): Promise<QueryResult> => {
    const result = (await supabase
      .from('alerts')
      .select(ALERT_SELECT)
      .order('created_at', { ascending: false })) as QueryResult
    return result
  }, [])

  const applyResults = useCallback((result: QueryResult) => {
    if (result.error) {
      setError(result.error.message)
    } else {
      setAlerts((result.data ?? []) as AlertRow[])
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

  const load = useCallback(async () => {
    applyResults(await fetchResults())
  }, [fetchResults, applyResults])

  async function runAction(
    alert: AlertRow,
    action: 'approve_alert' | 'publish_alert' | 'cancel_alert',
    note?: string,
  ) {
    setError('')
    setNotice('')
    setBusyId(alert.id)
    try {
      const { error: rpcError } = await supabase.rpc(action, {
        alert_id: alert.id,
        ...(action === 'cancel_alert' ? { reason: note } : {}),
      })
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setNotice(
        action === 'approve_alert'
          ? `Approved "${alert.title}".`
          : action === 'publish_alert'
            ? `Published "${alert.title}" in the app. No SMS or email was sent.`
            : `Cancelled "${alert.title}". The record is retained.`,
      )
      await load()
    } finally {
      setBusyId('')
    }
  }

  async function correctAlert(alert: AlertRow) {
    setError('')
    setNotice('')
    setBusyId(alert.id)
    try {
      const { error: rpcError } = await supabase.rpc('correct_alert', {
        alert_id: alert.id,
        new_title: correctTitle.trim(),
        new_body: correctBody.trim(),
        reason: correctReason.trim() || 'no reason given',
      })
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setNotice('Correction created as a new draft. The published version is retained.')
      setCorrectingId('')
      setCorrectTitle('')
      setCorrectBody('')
      setCorrectReason('')
      await load()
    } finally {
      setBusyId('')
    }
  }

  async function saveDraft(alert: AlertRow) {
    setError('')
    setNotice('')
    setBusyId(alert.id)
    try {
      const { error: updateError } = await supabase
        .from('alerts')
        .update({
          title: draftTitle.trim(),
          body: draftBody.trim(),
          severity: draftSeverity,
          target_scope: draftScope,
          target_role: draftScope === 'role' ? draftRole : null,
        })
        .eq('id', alert.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setNotice('Draft updated.')
      setEditingId('')
      await load()
    } finally {
      setBusyId('')
    }
  }

  function startEditing(alert: AlertRow) {
    setEditingId(alert.id)
    setDraftTitle(alert.title)
    setDraftBody(alert.body)
    setDraftSeverity(alert.severity)
    setDraftScope(alert.target_scope)
    setDraftRole(alert.target_role ?? 'teacher_staff')
  }

  return (
    <main id="main" className="admin-page">
      <h1>Alert management</h1>
      <p className="admin-subtitle">
        Draft an announcement, have it approved, then publish it to the app. Only
        administrators can approve, publish, correct or cancel. Publishing never sends an
        SMS, email or push message.
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

      <form
        className="rep-form"
        aria-label="New alert draft"
        onSubmit={(e) => {
          e.preventDefault()
          void createDraft()
        }}
      >
        <h2>New draft</h2>
        <label htmlFor="alert-title">Title</label>
        <input
          id="alert-title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="e.g. Drill on Friday at 10:00"
        />

        <label htmlFor="alert-body">Message</label>
        <textarea
          id="alert-body"
          rows={3}
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="What should people know?"
        />

        <label htmlFor="alert-severity">Severity</label>
        <select
          id="alert-severity"
          value={draftSeverity}
          onChange={(e) => setDraftSeverity(e.target.value)}
        >
          {ALERT_SEVERITIES.map((severity) => (
            <option key={severity.value} value={severity.value}>
              {severity.label}
            </option>
          ))}
        </select>

        <label htmlFor="alert-scope">Audience</label>
        <select
          id="alert-scope"
          value={draftScope}
          onChange={(e) => setDraftScope(e.target.value)}
        >
          {ALERT_SCOPES.map((scope) => (
            <option key={scope.value} value={scope.value}>
              {scope.label}
            </option>
          ))}
        </select>

        {draftScope === 'role' && (
          <>
            <label htmlFor="alert-role">Role</label>
            <select
              id="alert-role"
              value={draftRole}
              onChange={(e) => setDraftRole(e.target.value)}
            >
              {ROLES.map((roleName) => (
                <option key={roleName} value={roleName}>
                  {roleName}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="loc-form-actions">
          <button type="submit" className="btn" disabled={submitting}>
            Save draft
          </button>
        </div>
      </form>

      <h2>All alerts</h2>
      {loading ? (
        <p role="status">Loading alerts…</p>
      ) : alerts.length === 0 ? (
        <p className="loc-empty">No alerts yet.</p>
      ) : (
        <ul className="loc-list">
          {alerts.map((alert) => (
            <li key={alert.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">{alert.title}</span>
                <span className={`rep-status rep-status-${alert.severity}`}>
                  {severityLabel(alert.severity)}
                </span>
              </div>
              <span className="loc-meta">
                {statusLabel(alert.status)} · {scopeLabel(alert)} · version {alert.version} ·
                created {formatAlertTime(alert.created_at)}
              </span>
              <p className="rep-description">{alert.body}</p>
              {alert.status === 'cancelled' && alert.cancel_reason && (
                <span className="loc-meta">Cancelled: {alert.cancel_reason}</span>
              )}

              {editingId === alert.id && (
                <div className="rep-form">
                  <label htmlFor={`edit-title-${alert.id}`}>Title</label>
                  <input
                    id={`edit-title-${alert.id}`}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                  <label htmlFor={`edit-body-${alert.id}`}>Message</label>
                  <textarea
                    id={`edit-body-${alert.id}`}
                    rows={3}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                  />
                  <div className="loc-form-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === alert.id}
                      onClick={() => void saveDraft(alert)}
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setEditingId('')}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {correctingId === alert.id && (
                <div className="rep-form">
                  <label htmlFor={`correct-title-${alert.id}`}>Corrected title</label>
                  <input
                    id={`correct-title-${alert.id}`}
                    value={correctTitle}
                    onChange={(e) => setCorrectTitle(e.target.value)}
                  />
                  <label htmlFor={`correct-body-${alert.id}`}>Corrected message</label>
                  <textarea
                    id={`correct-body-${alert.id}`}
                    rows={3}
                    value={correctBody}
                    onChange={(e) => setCorrectBody(e.target.value)}
                  />
                  <label htmlFor={`correct-reason-${alert.id}`}>Reason for the correction</label>
                  <input
                    id={`correct-reason-${alert.id}`}
                    value={correctReason}
                    onChange={(e) => setCorrectReason(e.target.value)}
                  />
                  <div className="loc-form-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === alert.id}
                      onClick={() => void correctAlert(alert)}
                    >
                      Create correction
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setCorrectingId('')}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="loc-actions">
                {alert.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyId === alert.id}
                      onClick={() => startEditing(alert)}
                    >
                      Edit draft
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === alert.id}
                        onClick={() => void runAction(alert, 'approve_alert')}
                      >
                        Approve
                      </button>
                    )}
                  </>
                )}
                {alert.status === 'approved' && isAdmin && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === alert.id}
                    onClick={() => void runAction(alert, 'publish_alert')}
                  >
                    Publish
                  </button>
                )}
                {alert.status === 'published' && isAdmin && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === alert.id}
                    onClick={() => {
                      setCorrectingId(alert.id)
                      setCorrectTitle(alert.title)
                      setCorrectBody(alert.body)
                    }}
                  >
                    Correct
                  </button>
                )}
                {['draft', 'approved', 'published'].includes(alert.status) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === alert.id}
                    onClick={() => {
                      setCancellingId(alert.id)
                      setCancelReason('')
                    }}
                  >
                    Cancel alert
                  </button>
                )}
              </div>

              {cancellingId === alert.id && (
                <div className="rep-form">
                  <label htmlFor={`cancel-reason-${alert.id}`}>
                    Reason for cancelling
                  </label>
                  <input
                    id={`cancel-reason-${alert.id}`}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="e.g. the drill was postponed"
                  />
                  <div className="loc-form-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === alert.id}
                      onClick={() => {
                        void runAction(alert, 'cancel_alert', cancelReason.trim() || 'no reason given')
                        setCancellingId('')
                      }}
                    >
                      Confirm cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setCancellingId('')}
                    >
                      Keep alert
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )

  async function createDraft() {
    if (!schoolId) {
      setError('No school is assigned to this account.')
      return
    }
    if (draftTitle.trim().length < 3 || draftBody.trim().length < 3) {
      setError('An alert needs a title and a message')
      return
    }
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from('alerts').insert({
        school_id: schoolId,
        title: draftTitle.trim(),
        body: draftBody.trim(),
        severity: draftSeverity,
        target_scope: draftScope,
        target_role: draftScope === 'role' ? draftRole : null,
      })
      if (insertError) {
        setError(insertError.message)
        return
      }
      setDraftTitle('')
      setDraftBody('')
      setNotice('Draft saved. It needs approval before it can be published.')
      await load()
    } finally {
      setSubmitting(false)
    }
  }
}
