import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { AppRole } from '../auth/AuthContext'

interface ProfileRow {
  id: string
  display_name: string | null
  role: AppRole
}

const ROLE_OPTIONS: AppRole[] = ['student', 'teacher_staff', 'responder', 'administrator']

export default function AdminUsers() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('profiles')
      .select('id, display_name, role')
      .order('created_at', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setProfiles(data ?? [])
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleRoleChange(userId: string, newRole: AppRole) {
    setSavingId(userId)
    setError('')

    const { error: rpcError } = await supabase.rpc('admin_set_user_role', {
      target_user_id: userId,
      new_role: newRole,
    })

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, role: newRole } : p)),
      )
    }
    setSavingId(null)
  }

  return (
    <main className="admin-page">
      <h1>User Management</h1>
      <p className="admin-subtitle">Change user roles. All changes are audited.</p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading users…</p>
      ) : (
        <ul className="user-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="user-row">
              <div className="user-info">
                <span className="user-name">
                  {profile.display_name ?? 'Unnamed user'}
                </span>
                <span className="user-id">{profile.id}</span>
              </div>
              <label>
                <span className="sr-only">Role for {profile.display_name ?? profile.id}</span>
                <select
                  value={profile.role}
                  disabled={savingId === profile.id}
                  onChange={(e) =>
                    void handleRoleChange(profile.id, e.target.value as AppRole)
                  }
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
