import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
