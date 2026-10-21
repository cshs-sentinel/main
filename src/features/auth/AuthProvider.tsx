import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { AuthContext } from './AuthContext'
import type { AppRole } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadProfile(userId: string) {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, school_id')
        .eq('id', userId)
        .single()
      if (cancelled) return
      if (error) {
        setRole(null)
        setSchoolId(null)
        if (error.code === 'PGRST301' || error.message.includes('JWT')) {
          await supabase.auth.signOut()
        }
        return
      }
      setRole((data?.role as AppRole) ?? null)
      setSchoolId((data?.school_id as string) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        void loadProfile(data.session.user.id)
      } else {
        setRole(null)
        setSchoolId(null)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      if (newSession?.user) {
        void loadProfile(newSession.user.id)
      } else {
        setRole(null)
        setSchoolId(null)
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
      value={{ user: session?.user ?? null, session, role, schoolId, loading }}
    >
      {children}
    </AuthContext.Provider>
  )
}
