import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  ALERT_SELECT,
  formatAlertTime,
  scopeLabel,
  severityLabel,
} from './shared'
import type { AlertRow, CaseNotificationRow } from './shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export default function Alerts() {
  const { role } = useAuth()
  const isReviewer = role === 'responder' || role === 'administrator'
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [notifications, setNotifications] = useState<CaseNotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchResults = useCallback(async (): Promise<{
    alerts: QueryResult
    notifications: QueryResult
  }> => {
    const alertResult = (await supabase
      .from('alerts')
      .select(ALERT_SELECT)
      .eq('status', 'published')
      .order('published_at', { ascending: false })) as QueryResult

    const notificationResult = isReviewer
      ? ((await supabase
          .from('incident_notifications')
          .select('id, case_ref, title, body, created_at')
          .order('created_at', { ascending: false })
          .limit(10)) as QueryResult)
      : { data: [], error: null }

    return { alerts: alertResult, notifications: notificationResult }
  }, [isReviewer])

  const applyResults = useCallback(
    (results: { alerts: QueryResult; notifications: QueryResult }) => {
      if (results.alerts.error) {
        setError(results.alerts.error.message)
      } else {
        setAlerts((results.alerts.data ?? []) as AlertRow[])
      }
      if (results.notifications.error) {
        setError(results.notifications.error.message)
      } else {
        setNotifications((results.notifications.data ?? []) as CaseNotificationRow[])
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

  return (
    <main id="main" className="admin-page">
      <h1>Alerts</h1>
      <p className="admin-subtitle">
        Official announcements approved by an administrator. Alerts are published in the
        app only — no SMS, email or push message is sent.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading alerts…</p>
      ) : (
        <>
          {isReviewer && notifications.length > 0 && (
            <section className="dash-section">
              <h2>New cases</h2>
              <p className="loc-meta">
                Operational notifications for responders. These are not official
                announcements.
              </p>
              <ul className="loc-list">
                {notifications.map((notification) => (
                  <li key={notification.id} className="loc-row">
                    <div className="loc-head">
                      <span className="loc-name">{notification.case_ref}</span>
                      <span className="rep-status rep-status-open">New case</span>
                    </div>
                    <span className="loc-meta">{formatAlertTime(notification.created_at)}</span>
                    <p className="rep-description">{notification.body}</p>
                    <p className="loc-meta">
                      <Link to="/incidents">Open the incident queue</Link>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="dash-section">
            <h2>Official alerts</h2>
            {alerts.length === 0 ? (
              <p className="loc-empty">No published alerts for you right now.</p>
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
                      {scopeLabel(alert)} · published {formatAlertTime(alert.published_at)}
                      {alert.version > 1 ? ` · version ${alert.version}` : ''}
                    </span>
                    <p className="rep-description">{alert.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isReviewer && (
            <p className="loc-meta">
              <Link to="/admin/alerts">Manage alerts (draft, approve, publish)</Link>
            </p>
          )}
        </>
      )}
    </main>
  )
}
