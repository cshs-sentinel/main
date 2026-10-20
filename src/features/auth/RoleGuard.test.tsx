import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { AuthContext } from './AuthContext'
import type { AuthContextValue, AppRole } from './AuthContext'
import RoleGuard from './RoleGuard'

const mockUser = { id: 'u1' } as User

function renderWithRole(role: AppRole | null, loading = false) {
  const value: AuthContextValue = {
    user: role ? mockUser : null,
    session: null,
    role,
    loading,
  }

  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
          <Route element={<RoleGuard allowed={['administrator']} />}>
            <Route path="/admin" element={<div>Admin content</div>} />
          </Route>
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('RoleGuard', () => {
  it('shows loading state while auth is loading', () => {
    renderWithRole(null, true)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('redirects unauthenticated users to login', () => {
    renderWithRole(null)
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('redirects unauthorized roles to home', () => {
    renderWithRole('student')
    expect(screen.getByText('Home page')).toBeInTheDocument()
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()
  })

  it('allows authorized roles', () => {
    renderWithRole('administrator')
    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })
})
