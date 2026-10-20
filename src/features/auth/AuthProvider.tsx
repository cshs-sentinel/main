import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { AuthContext } from './AuthContext'
import type { AppRole } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadRole(userId: string) {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
      if (cancelled) return
      if (error) {
        setRole(null)
        if (error.code === 'PGRST301' || error.message.includes('JWT')) {
          await supabase.auth.signOut()
        }
        return
      }
      setRole((data?.role as AppRole) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        void loadRole(data.session.user.id)
      } else {
        setRole(null)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      if (newSession?.user) {
        void loadRole(newSession.user.id)
      } else {
        setRole(null)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{ user: session?.user ?? null, session, role, loading }}
    >
      {children}
    </AuthContext.Provider>
  )
}
