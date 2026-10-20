import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsers from './AdminUsers'

const { mockOrder, mockRpc } = vi.hoisted(() => ({
  mockOrder: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: mockOrder,
    })),
    rpc: mockRpc,
  },
}))

describe('AdminUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrder.mockResolvedValue({
      data: [
        { id: 'u1', display_name: 'Alice', role: 'student' },
        { id: 'u2', display_name: 'Bob', role: 'responder' },
      ],
      error: null,
    })
  })

  it('loads and lists users', async () => {
    render(<AdminUsers />)
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows error when fetch fails', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    render(<AdminUsers />)
    expect(await screen.findByRole('alert')).toHaveTextContent('RLS denied')
  })

  it('calls admin_set_user_role RPC on role change', async () => {
    const user = userEvent.setup()
    mockRpc.mockResolvedValue({ data: null, error: null })

    render(<AdminUsers />)
    await screen.findByText('Alice')

    const select = screen.getAllByRole('combobox')[0]
    await user.selectOptions(select, 'teacher_staff')

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('admin_set_user_role', {
        target_user_id: 'u1',
        new_role: 'teacher_staff',
      })
    })
  })

  it('shows error when RPC fails', async () => {
    const user = userEvent.setup()
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied: admin required' },
    })

    render(<AdminUsers />)
    await screen.findByText('Alice')

    const select = screen.getAllByRole('combobox')[0]
    await user.selectOptions(select, 'administrator')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'permission denied: admin required',
    )
  })
})
