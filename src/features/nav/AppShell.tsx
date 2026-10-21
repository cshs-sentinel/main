import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'

interface NavItem {
  to: string
  label: string
  hint: string
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', hint: 'Overview' },
  { to: '/check-in', label: 'Check-In', hint: 'Record that you are safe' },
  { to: '/sos', label: 'SOS', hint: 'Raise an emergency case' },
]

export default function AppShell() {
  const { role } = useAuth()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const isReviewer = role === 'responder' || role === 'administrator'
  const isAdmin = role === 'administrator'

  const moreLinks: { to: string; label: string; note?: string }[] = [
    { to: '/schedule', label: 'My schedule' },
    { to: '/reports', label: 'Report a hazard' },
    ...(isReviewer
      ? ([
          { to: '/admin/reports', label: 'Hazard report review' },
          { to: '/incidents', label: 'Incident response' },
        ] as { to: string; label: string; note?: string }[])
      : []),
    ...(isAdmin
      ? ([
          { to: '/admin/users', label: 'User management' },
          { to: '/admin/structure', label: 'School locations' },
          { to: '/admin/schedules', label: 'Schedules' },
        ] as { to: string; label: string; note?: string }[])
      : []),
    { to: '/alerts', label: 'Alerts', note: 'coming in the alerts phase' },
  ]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="app-header">
        <Link to="/" className="app-brand">
          SENTINEL
        </Link>
        <span className="app-role">{role ?? 'signed in'}</span>
        <button
          type="button"
          className="btn btn-secondary app-signout"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign out
        </button>
      </header>

      <div className="app-content">
        <Outlet />
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              isActive ? 'bottom-nav-item is-active' : 'bottom-nav-item'
            }
            aria-current={location.pathname === item.to ? 'page' : undefined}
          >
            <span className="bottom-nav-label">{item.label}</span>
            <span className="bottom-nav-hint">{item.hint}</span>
          </NavLink>
        ))}

        <button
          type="button"
          className={moreOpen ? 'bottom-nav-item is-active' : 'bottom-nav-item'}
          aria-expanded={moreOpen}
          aria-controls="more-menu"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="bottom-nav-label">More</span>
          <span className="bottom-nav-hint">Other pages</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="more-menu" id="more-menu">
          <div className="more-menu-head">
            <h2>More</h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setMoreOpen(false)}
            >
              Close
            </button>
          </div>
          <ul className="more-list">
            {moreLinks.map((link) => (
              <li key={link.to}>
                {link.note ? (
                  <span className="more-link is-disabled" aria-disabled="true">
                    {link.label}
                    <span className="more-note">{link.note}</span>
                  </span>
                ) : (
                  <Link
                    className="more-link"
                    to={link.to}
                    onClick={() => setMoreOpen(false)}
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
