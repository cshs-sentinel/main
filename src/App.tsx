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
import { supabase } from './lib/supabase'

function Home() {
  const { role } = useAuth()
  const isReviewer = role === 'responder' || role === 'administrator'

  return (
    <main className="auth-page">
      <h1>SENTINEL</h1>
      <p>Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and Logistics.</p>
      <p>You are signed in{role ? ` as ${role}` : ''}.</p>
      <p>
        <Link to="/dashboard">Dashboard</Link>
      </p>
      <p>
        <Link to="/check-in">Safety check-in</Link>
      </p>
      <p>
        <Link to="/sos">SOS</Link>
      </p>
      <p>
        <Link to="/schedule">My schedule</Link>
      </p>
      <p>
        <Link to="/reports">Report a hazard</Link>
      </p>
      {isReviewer && (
        <>
          <p>
            <Link to="/admin/reports">Report review</Link>
          </p>
          <p>
            <Link to="/incidents">Incident response</Link>
          </p>
        </>
      )}
      {role === 'administrator' && (
        <>
          <p>
            <Link to="/admin/users">User management</Link>
          </p>
          <p>
            <Link to="/admin/structure">School locations</Link>
          </p>
          <p>
            <Link to="/admin/schedules">Schedules</Link>
          </p>
        </>
      )}
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
