import '@testing-library/jest-dom/vitest'

// Provide safe mock env for unit tests so CI/local runs don't require a real .env
import.meta.env.VITE_SUPABASE_URL ??= 'https://test-project.supabase.co'
import.meta.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key'
