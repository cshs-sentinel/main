import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('supabase client', () => {
  const originalUrl = import.meta.env.VITE_SUPABASE_URL
  const originalKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    import.meta.env.VITE_SUPABASE_URL = originalUrl
    import.meta.env.VITE_SUPABASE_ANON_KEY = originalKey
  })

  it('creates a client when env vars are present', async () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key'

    const mod = await import('./supabase')
    expect(mod.supabase).toBeDefined()
    expect(mod.supabase).toHaveProperty('auth')
  })

  it('throws when env vars are missing', async () => {
    import.meta.env.VITE_SUPABASE_URL = ''
    import.meta.env.VITE_SUPABASE_ANON_KEY = ''

    await expect(import('./supabase')).rejects.toThrow(
      'Missing Supabase environment variables',
    )
  })
})
