import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { useAuth } from './features/auth/AuthContext'
import Login from './features/auth/Login'
import ProtectedRoute from './features/auth/ProtectedRoute'
import RoleGuard from './features/auth/RoleGuard'
import SignUp from './features/auth/SignUp'
import AdminUsers from './features/admin/AdminUsers'
import { supabase } from './lib/supabase'

function Home() {
  const { role } = useAuth()

  return (
    <main className="auth-page">
      <h1>SENTINEL</h1>
      <p>Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and Logistics.</p>
      <p>You are signed in{role ? ` as ${role}` : ''}.</p>
      {role === 'administrator' && (
        <p>
          <Link to="/admin/users">User management</Link>
        </p>
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
            <Route element={<RoleGuard allowed={['administrator']} />}>
              <Route path="/admin/users" element={<AdminUsers />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
