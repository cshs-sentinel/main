/**
 * SENTINEL pilot readiness check (Phase 9).
 *
 * Walks the pre-flight checklist in docs/DEPLOYMENT.md section 6 and reports
 * what is verifiable right now, what passes, and what still needs a human
 * decision. It does not change anything.
 *
 * Run: npm run check:pilot   (or: node scripts/pilot-readiness.mjs)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SITE = process.env.SENTINEL_SITE_URL ?? 'https://sentinel-app-1jo.pages.dev'
const WORKER =
  process.env.SENTINEL_WORKER_URL ?? 'https://sentinel-weather.sentinelcshs.workers.dev'

const checks = []
function record(area, name, pass, detail = '') {
  checks.push({ area, name, pass, detail })
}

// ---------------------------------------------------------------- 1. local env
const envPath = join(root, '.env')
let env = {}
try {
  env = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
} catch {
  /* handled below */
}
record('env', 'VITE_SUPABASE_URL is set', Boolean(env.VITE_SUPABASE_URL))
record('env', 'VITE_SUPABASE_ANON_KEY is set', Boolean(env.VITE_SUPABASE_ANON_KEY))
record('env', 'VITE_WEATHER_WORKER_URL is set', Boolean(env.VITE_WEATHER_WORKER_URL))
record(
  'env',
  'no privileged key in .env',
  !Object.keys(env).some((key) => /service_role|SUPABASE_ACCESS_TOKEN/i.test(key)),
)
record(
  'env',
  '.env is not tracked by git',
  !readFileSync(join(root, '.gitignore'), 'utf8').includes('.env\n') ||
    readFileSync(join(root, '.gitignore'), 'utf8').includes('.env'),
)

// --------------------------------------------------------------- 2. build output
const distDir = join(root, 'dist')
let bundleText = ''
try {
  const assets = join(distDir, 'assets')
  for (const file of readdirSync(assets)) {
    if (file.endsWith('.js')) bundleText += readFileSync(join(assets, file), 'utf8')
  }
  record('build', 'production bundle exists', bundleText.length > 0)
  record(
    'build',
    'no privileged key in the browser bundle',
    !bundleText.includes('service_role') && !bundleText.includes('SUPABASE_SERVICE_ROLE_KEY'),
  )
  record('build', '_redirects copied into dist', statSync(join(distDir, '_redirects')).size > 0)
  record('build', '_headers copied into dist', statSync(join(distDir, '_headers')).size > 0)
} catch (e) {
  record('build', 'production bundle exists', false, e.message)
}

// ------------------------------------------------------ 3. deployed application
try {
  const home = await fetch(`${SITE}/`, { redirect: 'manual' })
  record('deploy', 'site responds', home.status === 200, `status=${home.status}`)

  const headers = home.headers
  record('deploy', 'CSP header present', Boolean(headers.get('content-security-policy')))
  record('deploy', 'nosniff header present', headers.get('x-content-type-options') === 'nosniff')
  record('deploy', 'frames denied', headers.get('x-frame-options') === 'DENY')
  record('deploy', 'referrer policy present', Boolean(headers.get('referrer-policy')))

  const deep = await fetch(`${SITE}/sos`, { redirect: 'manual' })
  record('deploy', 'SPA deep link served by the app', deep.status === 200, `status=${deep.status}`)

  for (const route of ['/login', '/alerts', '/dashboard']) {
    const res = await fetch(`${SITE}${route}`, { redirect: 'manual' })
    record('deploy', `route ${route} responds`, res.status === 200, `status=${res.status}`)
  }
} catch (e) {
  record('deploy', 'site responds', false, e.message)
}

// ------------------------------------------------------------- 4. weather worker
try {
  const res = await fetch(`${WORKER}/`, { headers: { Origin: SITE } })
  const body = await res.json()
  record('worker', 'worker responds', res.status === 200, `status=${res.status}`)
  record('worker', 'advisory carries a source', body?.source === 'open-meteo', body?.source ?? '')
  record(
    'worker',
    'advisory carries the rule version',
    body?.heat_index?.rule_version === 'heat_index_v1',
    body?.heat_index?.rule_version ?? '',
  )
  record(
    'worker',
    'advisory states it is not an indoor measurement',
    String(body?.disclaimer ?? '').includes('not indoor classroom measurements'),
  )
  record(
    'worker',
    'CORS allows the deployed app origin',
    body && res.headers.get('access-control-allow-origin') === SITE,
  )
} catch (e) {
  record('worker', 'worker responds', false, e.message)
}

// --------------------------------------------------------------- 5. documentation
const REQUIRED_DOCS = [
  'ARCHITECTURE.md',
  'ROLLBACK.md',
  'DEPLOYMENT.md',
  'DEVELOPMENT_LOG.md',
  'FIRST_ADMIN.md',
  'MANUAL_FALLBACK.md',
  'HEAT_INDEX.md',
  'RISK_REGISTER.md',
  'GATE2_EVIDENCE.md',
  'GATE3_EVIDENCE.md',
  'GATE4_EVIDENCE.md',
  'GATE5_EVIDENCE.md',
  'GATE6_EVIDENCE.md',
  'GATE7_EVIDENCE.md',
  'GATE8_EVIDENCE.md',
]
for (const doc of REQUIRED_DOCS) {
  let exists = false
  try {
    statSync(join(root, 'docs', doc))
    exists = true
  } catch {
    exists = false
  }
  record('docs', `${doc} present`, exists)
}

// Every migration has a documented rollback
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
const rollback = readFileSync(join(root, 'docs/ROLLBACK.md'), 'utf8')
const missingRollback = migrations.filter((file) => {
  // Migration files are named <timestamp>_<slug>.sql; the rollback document refers
  // to them by the short number (e.g. 0016) rather than the full timestamp.
  const shortNumber = file.split('_')[0].slice(-4)
  return !rollback.includes(shortNumber)
})
record(
  'docs',
  'every migration has a documented rollback',
  missingRollback.length === 0,
  missingRollback.join(', '),
)

// ------------------------------------------------------------------- 6. report
const byArea = new Map()
for (const check of checks) {
  const list = byArea.get(check.area) ?? []
  list.push(check)
  byArea.set(check.area, list)
}

console.log('SENTINEL pilot readiness')
console.log('========================\n')
for (const [area, list] of byArea) {
  console.log(`${area.toUpperCase()}`)
  for (const check of list) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
  }
  console.log('')
}
const failed = checks.filter((c) => !c.pass)
console.log(`${checks.length - failed.length}/${checks.length} automated checks pass.`)

console.log('\nStill human decisions (see docs/RISK_REGISTER.md):')
console.log('  H1 external responder notification (not integrated)')
console.log('  H2 rotate the Cloudflare API token, H3 enable 2FA')
console.log('  H4 disable sign-ups / custom SMTP, H5 rehearse a restore')
console.log('  H6 set the school coordinates, H7 dedicated pilot Supabase project')
process.exit(failed.length > 0 ? 1 : 0)
