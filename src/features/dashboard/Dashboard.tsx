import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { statusLabel } from '../incidents/shared'
import WeatherAdvisory from '../weather/WeatherAdvisory'
import type { IncidentRow } from '../incidents/shared'

interface DashboardCounts {
  role?: string
  my_open_incidents?: number
  my_open_reports?: number
  my_check_ins_today?: number
  my_need_help?: number
  school_open_incidents?: number
  school_unacknowledged_incidents?: number
  school_oldest_unacknowledged_minutes?: number
  school_open_reports?: number
  school_check_ins_today?: number
  school_need_help?: number
  users_total?: number
  users_by_role?: Record<string, number>
  audit_rows_30d?: number
}

export default function Dashboard() {
  const { role, user } = useAuth()
  const [counts, setCounts] = useState<DashboardCounts>({})
  const [myIncidents, setMyIncidents] = useState<IncidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isReviewer = role === 'responder' || role === 'administrator'
  const isStaff = isReviewer || role === 'teacher_staff'

  const fetchResults = useCallback(async () => {
    const [countResult, incidentResult] = await Promise.all([
      supabase.rpc('dashboard_counts'),
      supabase
        .from('incidents')
        .select('id, case_ref, status, category, description, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ])
    return { countResult, incidentResult }
  }, [])

  const applyResults = useCallback(
    (
      countResult: { data: unknown; error: { message: string } | null },
      incidentResult: { data: unknown; error: { message: string } | null },
    ) => {
      if (countResult.error) {
        setError(countResult.error.message)
      } else {
        setCounts((countResult.data ?? {}) as DashboardCounts)
      }
      if (incidentResult.error) {
        setError(incidentResult.error.message)
      } else {
        setMyIncidents((incidentResult.data ?? []) as IncidentRow[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then((result) => {
      if (cancelled) return
      applyResults(result.countResult, result.incidentResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  if (loading) {
    return (
      <main className="admin-page">
        <h1>Dashboard</h1>
        <p role="status">Loading dashboard…</p>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <h1>Dashboard</h1>
      <p className="admin-subtitle">
        Signed in as {user?.id ? 'an account' : 'a user'}
        {role ? ` (${role})` : ''}. You only see what your role is allowed to see.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <section className="dash-section">
        <h2>My status</h2>
        <ul className="dash-tiles">
          <li className="dash-tile">
            <span className="dash-value" data-testid="dash-tile-value">{counts.my_check_ins_today ?? 0}</span>
            <span className="dash-label">check-ins today</span>
          </li>
          <li className="dash-tile">
            <span className="dash-value" data-testid="dash-tile-value">{counts.my_open_incidents ?? 0}</span>
            <span className="dash-label">open cases I raised</span>
          </li>
          <li className="dash-tile">
            <span className="dash-value" data-testid="dash-tile-value">{counts.my_open_reports ?? 0}</span>
            <span className="dash-label">open reports I filed</span>
          </li>
          {(counts.my_need_help ?? 0) > 0 && (
            <li className="dash-tile dash-tile-alert">
              <span className="dash-value" data-testid="dash-tile-value">{counts.my_need_help}</span>
              <span className="dash-label">check-ins asking for help</span>
            </li>
          )}
        </ul>
        <p className="loc-meta">
          <Link to="/sos">Raise an SOS</Link> · <Link to="/check-in">Record a check-in</Link> ·{' '}
          <Link to="/reports">File a hazard report</Link>
        </p>
      </section>

      {isStaff && (
        <section className="dash-section">
          <h2>School summary</h2>
          <p className="loc-meta">Counts only — no names or locations of individuals.</p>
          <ul className="dash-tiles">
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.school_open_incidents ?? 0}</span>
              <span className="dash-label">open cases</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.school_unacknowledged_incidents ?? 0}</span>
              <span className="dash-label">not yet acknowledged</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.school_open_reports ?? 0}</span>
              <span className="dash-label">open hazard reports</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.school_check_ins_today ?? 0}</span>
              <span className="dash-label">check-ins today</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.school_need_help ?? 0}</span>
              <span className="dash-label">asking for help</span>
            </li>
          </ul>
          {(counts.school_oldest_unacknowledged_minutes ?? 0) > 0 && (
            <p className="loc-meta">
              Oldest unacknowledged case: {counts.school_oldest_unacknowledged_minutes} minutes
              old.
            </p>
          )}
        </section>
      )}

      {isReviewer && (
        <section className="dash-section">
          <h2>Response</h2>
          <p className="loc-meta">
            <Link to="/incidents">Incident response queue</Link> ·{' '}
            <Link to="/admin/reports">Hazard report review</Link>
          </p>
        </section>
      )}

      {isReviewer && <WeatherAdvisory />}

      {role === 'administrator' && (
        <section className="dash-section">
          <h2>Administration</h2>
          <ul className="dash-tiles">
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.users_total ?? 0}</span>
              <span className="dash-label">accounts in this school</span>
            </li>
            <li className="dash-tile">
              <span className="dash-value" data-testid="dash-tile-value">{counts.audit_rows_30d ?? 0}</span>
              <span className="dash-label">audit entries (30 days)</span>
            </li>
          </ul>
          {counts.users_by_role && (
            <ul className="dash-roles">
              {Object.entries(counts.users_by_role).map(([roleName, count]) => (
                <li key={roleName}>
                  {roleName}: {count}
                </li>
              ))}
            </ul>
          )}
          <p className="loc-meta">
            <Link to="/admin/users">User management</Link> ·{' '}
            <Link to="/admin/structure">School locations</Link> ·{' '}
            <Link to="/admin/schedules">Schedules</Link>
          </p>
        </section>
      )}

      {myIncidents.length > 0 && (
        <section className="dash-section">
          <h2>Recent cases</h2>
          <ul className="loc-list">
            {myIncidents.map((incident) => (
              <li key={incident.id} className="loc-row">
                <div className="loc-head">
                  <span className="loc-name">{incident.case_ref}</span>
                  <span className={`rep-status rep-status-${incident.status}`}>
                    {statusLabel(incident.status)}
                  </span>
                </div>
                <p className="rep-description">{incident.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dash-section">
        <h2>Not available yet</h2>
        <ul className="dash-roles">
          <li>Published alerts — the alert workflow is not built yet (later phase).</li>
          {!isReviewer && (
            <li>Weather advisory — shown to responders and administrators only.</li>
          )}
        </ul>
      </section>
    </main>
  )
}
