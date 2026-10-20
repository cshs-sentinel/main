import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from './AuthProvider'
import ProtectedRoute from './ProtectedRoute'

function renderWithAuth() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Protected content</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('shows loading state initially', () => {
    renderWithAuth()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('redirects to login when unauthenticated', async () => {
    renderWithAuth()
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })
})
