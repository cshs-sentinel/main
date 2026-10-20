import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SignUp from './SignUp'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
    },
  },
}))

import { supabase } from '../../lib/supabase'

describe('SignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all fields', () => {
    render(
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/email/i), 'new@example.test')
    await user.type(screen.getByLabelText(/^password$/i), 'Password123')
    await user.type(screen.getByLabelText(/confirm password/i), 'Password456')
    await user.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(supabase.auth.signUp).not.toHaveBeenCalled()
  })

  it('shows success message on successful signup', async () => {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u2' }, session: null },
      error: null,
    } as never)

    render(
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/email/i), 'new@example.test')
    await user.type(screen.getByLabelText(/^password$/i), 'Password123')
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123')
    await user.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/check your email/i)
  })
})
