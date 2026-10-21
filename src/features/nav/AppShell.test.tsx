import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'
import { AuthContext } from '../auth/AuthContext'
import type { AuthContextValue, AppRole } from '../auth/AuthContext'

const { state } = vi.hoisted(() => ({
  state: { signedOut: 0 },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: async () => {
        state.signedOut += 1
        return { error: null }
      },
    },
  },
}))

const mockUser = { id: 'user-1' } as User

function renderShell(role: AppRole, path = '/') {
  const value: AuthContextValue = {
    user: mockUser,
    session: null,
    role,
    schoolId: '11111111-1111-1111-1111-111111111111',
    loading: false,
  }
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>home content</p>} />
            <Route path="/sos" element={<p>sos content</p>} />
            <Route path="/check-in" element={<p>check-in content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    state.signedOut = 0
  })

  it('renders a primary navigation landmark with the main pages', () => {
    renderShell('student')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: /Home/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Check-In/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /SOS/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /More/ })).toBeInTheDocument()
  })

  it('provides a skip link to the main content', () => {
    renderShell('student')
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveAttribute('href', '#main')
  })

  it('marks the current page for assistive technology', () => {
    renderShell('student', '/sos')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const sos = within(nav).getByRole('link', { name: /SOS/ })
    expect(sos).toHaveAttribute('aria-current', 'page')
  })

  it('opens the More menu with the pages for a student', async () => {
    const user = userEvent.setup()
    renderShell('student')
    await user.click(screen.getByRole('button', { name: /More/ }))

    const menu = screen.getByRole('button', { name: /More/ })
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'My schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send information' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Incident response' })).not.toBeInTheDocument()
  })

  it('shows responder and administrator links to an administrator', async () => {
    const user = userEvent.setup()
    renderShell('administrator')
    await user.click(screen.getByRole('button', { name: /More/ }))

    expect(screen.getByRole('link', { name: 'Incident response' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'User management' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'School locations' })).toBeInTheDocument()
  })

  it('offers alerts as a primary tab now that the feed exists', async () => {
    const user = userEvent.setup()
    renderShell('student')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: /Alerts/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.queryByRole('link', { name: 'Alerts' })).not.toBeInTheDocument()
  })

  it('closes the More menu again', async () => {
    const user = userEvent.setup()
    renderShell('student')
    await user.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.getByRole('link', { name: 'My schedule' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('link', { name: 'My schedule' })).not.toBeInTheDocument()
  })

  it('offers sign-out in the header', async () => {
    const user = userEvent.setup()
    renderShell('student')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(state.signedOut).toBe(1)
  })

  it('shows the signed-in role in the header', () => {
    renderShell('responder')
    expect(screen.getByText('responder')).toBeInTheDocument()
  })
})
