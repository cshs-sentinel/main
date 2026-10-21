/**
 * SENTINEL project bootstrap (Phase 9).
 *
 * Prepares a freshly created Supabase project for the pilot:
 *   1. applies every migration in supabase/migrations/ in order,
 *   2. optionally seeds the synthetic demo school,
 *   3. prints the remaining manual steps.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<management token> \
 *   SUPABASE_PROJECT_REF=<project ref> \
 *   node scripts/bootstrap-project.mjs
 *
 * The management token can create nothing - it is used here only to run SQL
 * against the target project.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT = process.env.SUPABASE_PROJECT_REF

if (!TOKEN || !PROJECT) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF first.')
  console.error('Example (PowerShell):')
  console.error('  $env:SUPABASE_ACCESS_TOKEN = "<management token>"')
  console.error('  $env:SUPABASE_PROJECT_REF = "<project ref>"')
  process.exit(1)
}

const migrationsDir = resolve(import.meta.dirname, '../supabase/migrations')
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 400))
  return Array.isArray(body) ? body : []
}

console.log(`Bootstrapping project ${PROJECT} with ${migrations.length} migrations\n`)

for (const file of migrations) {
  const statements = readFileSync(resolve(migrationsDir, file), 'utf8')
  try {
    await sql(statements)
    console.log(`  applied ${file}`)
  } catch (error) {
    console.error(`  FAILED  ${file}\n           ${error.message}`)
    console.error('\nBootstrap stopped. Fix the error above and re-run (applied migrations are skipped safely).')
    process.exit(1)
  }
}

const tables = await sql(
  `select count(*)::int as n from information_schema.tables
    where table_schema = 'public' and table_name in
    ('profiles','schools','locations','schedules','hazard_reports','incidents','alerts','check_ins')`,
)
console.log(`\ncore tables present: ${tables[0].n}/8`)

const rls = await sql(
  `select count(*)::int as n from pg_tables
    where schemaname = 'public' and rowsecurity`,
)
console.log(`tables with RLS enabled: ${rls[0].n}`)

console.log(`
Next steps:
  1. Create the first administrator in the app's sign-up page, then promote it:
       update public.profiles set role = 'administrator' where id = '<USER_UUID>';
     (see docs/FIRST_ADMIN.md)
  2. Copy the project's URL and anon key into the build environment:
       VITE_SUPABASE_URL=https://<ref>.supabase.co
       VITE_SUPABASE_ANON_KEY=<anon key>
  3. Seed the synthetic demo school (optional but recommended for the pilot):
       node scripts/seed-school.mjs
  4. Set the auth configuration for the pilot hostname:
       site_url = the pilot origin, uri_allow_list = the pilot origin,
       disable_signup = true (unless the school wants self-registration)
  5. Point the weather worker at the pilot project:
       npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
       npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
       npx wrangler deploy --config worker/wrangler.toml
  6. Deploy the app against the pilot project and re-run the checks:
       npm run check:pilot
`)
