// RLS verification for SENTINEL identity migration.
// Uses existing test users created in the dashboard.
// Run: node scripts/verify-rls.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(import.meta.dirname, '../.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const admin = createClient(url, anonKey)
const results = []
const STUDENT_ID = '62dde16a-cda1-4f21-9923-8c216e668142'
const ADMIN_ID = 'aba76dd7-1503-4444-b1b5-6fb96aaef819'

function log(name, pass, detail = '') {
  results.push({ name, pass, detail })
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(url, anonKey)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signin ${email}: ${error.message}`)
  return client
}

async function main() {
  console.log('SENTINEL RLS Verification')
  console.log('=========================\n')

  // 1. Anon access
  console.log('1. Anon access');
  const { data: anonProfiles, error: anonErr } = await admin.from('profiles').select('*')
  log('Anon blocked from profiles', !anonErr && (anonProfiles?.length ?? 0) === 0,
    `rows=${anonProfiles?.length ?? 0}`)
  const { data: anonAudit } = await admin.from('audit_logs').select('*')
  log('Anon blocked from audit_logs', (anonAudit?.length ?? 0) === 0,
    `rows=${anonAudit?.length ?? 0}`)

  // 2. Sign in test users
  console.log('\n2. Sign in test users');
  let studentClient, adminClient
  try {
    studentClient = await signIn('rls-student@test.local', 'RlsTestPass123!')
    log('Student sign-in', true)
  } catch (e) {
    log('Student sign-in', false, e.message)
    return finish()
  }
  try {
    adminClient = await signIn('rls-admin@test.local', 'RlsTestPass123!')
    log('Admin sign-in', true)
  } catch (e) {
    log('Admin sign-in', false, e.message)
    return finish()
  }

  // 3. Profile role checks
  console.log('\n3. Profile roles');
  const { data: sp } = await studentClient.from('profiles').select('id, role').eq('id', STUDENT_ID).single()
  log('Student role is student', sp?.role === 'student', `role=${sp?.role}`)
  const { data: ap } = await adminClient.from('profiles').select('id, role').eq('id', ADMIN_ID).single()
  log('Admin role is administrator', ap?.role === 'administrator', `role=${ap?.role}`)

  // 4. Student RLS
  console.log('\n4. Student RLS');
  const { data: own } = await studentClient.from('profiles').select('id').eq('id', STUDENT_ID)
  log('Student reads own profile', (own?.length ?? 0) === 1)
  const { data: others } = await studentClient.from('profiles').select('id').neq('id', STUDENT_ID)
  log('Student cannot read other profiles', (others?.length ?? 0) === 0, `rows=${others?.length ?? 0}`)
  const { data: sAudit } = await studentClient.from('audit_logs').select('*')
  log('Student blocked from audit_logs', (sAudit?.length ?? 0) === 0)

  // 5. Admin RLS
  console.log('\n5. Admin RLS');
  const { data: allProfiles } = await adminClient.from('profiles').select('id, role')
  log('Admin reads all profiles', (allProfiles?.length ?? 0) >= 2, `rows=${allProfiles?.length}`)
  const { data: aAudit } = await adminClient.from('audit_logs').select('*')
  log('Admin can read audit_logs (may be empty)', aAudit !== null, `rows=${aAudit?.length ?? 'error'}`)

  // 6. RPC permissions
  console.log('\n6. RPC permissions');
  const { error: denied } = await studentClient.rpc('admin_set_user_role', {
    target_user_id: ADMIN_ID,
    new_role: 'student',
  })
  log('Non-admin RPC denied', !!denied, denied?.message ?? 'no error?')

  // Admin calls RPC to set student role to teacher_staff, then revert
  const { error: adminRpcErr } = await adminClient.rpc('admin_set_user_role', {
    target_user_id: STUDENT_ID,
    new_role: 'teacher_staff',
  })
  log('Admin RPC allowed', !adminRpcErr, adminRpcErr?.message ?? '')

  // Verify change
  const { data: changed } = await studentClient.from('profiles').select('role').eq('id', STUDENT_ID).single()
  log('Role change applied', changed?.role === 'teacher_staff', `role=${changed?.role}`)

  // Revert student back to student
  const { error: revertErr } = await adminClient.rpc('admin_set_user_role', {
    target_user_id: STUDENT_ID,
    new_role: 'student',
  })
  const { data: reverted } = await studentClient.from('profiles').select('role').eq('id', STUDENT_ID).single()
  log('Role reverted to student', reverted?.role === 'student' && !revertErr)

  // 7. Audit log written
  console.log('\n7. Audit trail');
  const { data: auditRows } = await adminClient
    .from('audit_logs')
    .select('action, entity_type, payload')
    .eq('action', 'role_changed')
  log('Audit rows for role changes', (auditRows?.length ?? 0) >= 2, `rows=${auditRows?.length}`)

  finish()
}

function finish() {
  console.log('\n=========================')
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log('\nFailed checks:')
    results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`))
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
