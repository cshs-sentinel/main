import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AppRole = 'student' | 'teacher_staff' | 'responder' | 'administrator'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  schoolId: string | null
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  role: null,
  schoolId: null,
  loading: true,
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
