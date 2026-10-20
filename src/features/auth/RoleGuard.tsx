import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import type { AppRole } from './AuthContext'

interface RoleGuardProps {
  allowed: AppRole[]
}

export default function RoleGuard({ allowed }: RoleGuardProps) {
  const { user, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="route-loading" role="status">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!role || !allowed.includes(role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
