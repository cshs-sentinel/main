import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { useAuth } from './features/auth/AuthContext'
import Login from './features/auth/Login'
import ProtectedRoute from './features/auth/ProtectedRoute'
import RoleGuard from './features/auth/RoleGuard'
import SignUp from './features/auth/SignUp'
import AdminUsers from './features/admin/AdminUsers'
import AdminSchedules from './features/admin/AdminSchedules'
import AdminReports from './features/admin/AdminReports'
import Locations from './features/admin/Locations'
import Schedule from './features/schedule/Schedule'
import Reports from './features/reports/Reports'
import CheckIn from './features/checkin/CheckIn'
import Sos from './features/incidents/Sos'
import AdminIncidents from './features/admin/AdminIncidents'
import Dashboard from './features/dashboard/Dashboard'
import AppShell from './features/nav/AppShell'

function Home() {
  const { role } = useAuth()
  const isReviewer = role === 'responder' || role === 'administrator'
  const isAdmin = role === 'administrator'

  return (
    <main id="main" className="home-page">
      <h1>SENTINEL</h1>
      <p className="home-tagline">
        Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and
        Logistics.
      </p>
      <p className="home-role">
        You are signed in{role ? ` as ${role}` : ''}.
      </p>

      <section className="home-section" aria-labelledby="home-actions">
        <h2 id="home-actions">What you can do</h2>
        <ul className="home-actions">
          <li>
            <Link to="/dashboard">Dashboard</Link> — your status and (for staff) school counts.
          </li>
          <li>
            <Link to="/check-in">Safety check-in</Link> — record that you are safe.
          </li>
          <li>
            <Link to="/sos">SOS</Link> — raise an emergency case for responders.
          </li>
          <li>
            <Link to="/schedule">My schedule</Link> — expected locations, not verified presence.
          </li>
          <li>
            <Link to="/reports">Report a hazard</Link> — file a facility or safety problem.
          </li>
          {isReviewer && (
            <li>
              <Link to="/incidents">Incident response</Link> — acknowledge and work school cases.
            </li>
          )}
          {isAdmin && (
            <li>
              <Link to="/admin/users">Administration</Link> — users, school locations and
              schedules.
            </li>
          )}
        </ul>
      </section>

      <p className="home-note">
        SENTINEL supports school response coordination. It does not replace emergency
        services or school leadership. In an emergency, call your local emergency number
        first.
      </p>
    </main>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/check-in" element={<CheckIn />} />
              <Route path="/sos" element={<Sos />} />
              <Route element={<RoleGuard allowed={['responder', 'administrator']} />}>
                <Route path="/admin/reports" element={<AdminReports />} />
                <Route path="/incidents" element={<AdminIncidents />} />
              </Route>
              <Route element={<RoleGuard allowed={['administrator']} />}>
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/structure" element={<Locations />} />
                <Route path="/admin/schedules" element={<AdminSchedules />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
