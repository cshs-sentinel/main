import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import Login from './features/auth/Login'
import ProtectedRoute from './features/auth/ProtectedRoute'
import SignUp from './features/auth/SignUp'
import { supabase } from './lib/supabase'

function Home() {
  return (
    <main className="auth-page">
      <h1>SENTINEL</h1>
      <p>Smart Emergency Network for Tracking Incidents, Notifications, Evaluation, and Logistics.</p>
      <p>You are signed in.</p>
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
