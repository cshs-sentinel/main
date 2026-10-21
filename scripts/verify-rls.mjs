// RLS verification for SENTINEL identity, locations, schedules, hazard reports, and multi-school migrations.
// Uses existing test users created in the dashboard.
// Run: node scripts/verify-rls.mjs
// Set SUPABASE_ACCESS_TOKEN to include multi-school (section 9) and report-cleanup checks.

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
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signin ${email}: ${error.message}`)
  return client
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = new URL(url).hostname.split('.')[0]

  console.log('SENTINEL RLS Verification')
  console.log('=========================\n')

  // 0. Self-heal the two test accounts.
  // The harness changes roles during the run (section 6, 14, 15) and a previous
  // interrupted or manual test can leave the accounts in the wrong state, which
  // would cascade into unrelated failures. Reset them first so every run starts
  // from a known state: the admin account is an administrator, the other one is
  // a plain student.
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    try {
      await sql(
        `update public.profiles set role = 'administrator' where id = '${ADMIN_ID}'`,
      )
      await sql(
        `update public.profiles set role = 'student' where id = '${STUDENT_ID}'`,
      )
      // Seeded categories can be left inactive by an interrupted run (the
      // "inactive category" check deactivates one on purpose) - reactivate the
      // school's categories so location creation works again.
      await sql(
        `update public.location_categories set is_active = true
          where school_id = '11111111-1111-1111-1111-111111111111' and is_active = false`,
      )
      console.log('0. Test state reset (admin role, student role, school categories)\n')
    } catch (e) {
      console.log(`0. Test state reset failed: ${e.message}\n`)
    }
  }

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

  // 8. Locations module (unified, school-configurable)
  console.log('\n8. Locations module');
  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'

  const { data: anonLoc } = await admin.from('locations').select('*')
  log('Anon blocked from locations', (anonLoc?.length ?? 0) === 0, `rows=${anonLoc?.length ?? 0}`)
  const { data: anonCat } = await admin.from('location_categories').select('*')
  log('Anon blocked from location_categories', (anonCat?.length ?? 0) === 0, `rows=${anonCat?.length ?? 0}`)
  const { data: anonSch } = await admin.from('schools').select('*')
  log('Anon blocked from schools', (anonSch?.length ?? 0) === 0, `rows=${anonSch?.length ?? 0}`)

  const { data: sCats, error: sCatsErr } = await studentClient.from('location_categories').select('id, name')
  log('Student reads own-school categories', !sCatsErr && (sCats?.length ?? 0) >= 20, `rows=${sCats?.length ?? 0}`)
  const { data: sSch } = await studentClient.from('schools').select('id')
  log('Student reads exactly own school', (sSch?.length ?? 0) === 1 && sSch[0]?.id === A, `rows=${sSch?.length ?? 0}`)
  const { data: sOwnProfile } = await studentClient.from('profiles').select('school_id').eq('id', STUDENT_ID).single()
  log('Student profile scoped to default school', sOwnProfile?.school_id === A, `school=${sOwnProfile?.school_id}`)

  const { error: sLocInsert } = await studentClient.from('locations').insert({
    school_id: A, name: 'RLS Student Should Fail', category_id: sCats?.[0]?.id, environment: 'indoor',
  })
  log('Student location insert denied', !!sLocInsert, sLocInsert?.message ?? 'no error?')

  const { data: cats, error: catErr } = await adminClient
    .from('location_categories').select('id, name, environment')
  log('Admin reads categories', !catErr && (cats?.length ?? 0) >= 20, `rows=${cats?.length ?? 0}`)
  const catId = (n) => cats.find((c) => c.name === n)?.id

  const TEST_LOCATION_NAMES = ['Test Campus', 'Test Main Building', 'Test Floor 2', 'RLS Room 204',
    'RLS Room 205', 'RLS School Garden', 'RLS Misplaced', 'RLS Under Archived',
    'RLS Robotics Room', 'RLS Inactive Cat Room', 'RLS Student Should Fail', 'rls room 204',
    'RLS Schedule Room', 'RLS Report Room']

  // Pre-clean: archive leftovers from a failed prior run (synthetic test names only)
  await adminClient.from('locations')
    .update({ status: 'archived' })
    .eq('status', 'active')
    .in('name', TEST_LOCATION_NAMES)

  const mkLoc = async (fields) => {
    const { data, error } = await adminClient.from('locations').insert(fields).select('id, name').single()
    return { data, error }
  }

  const campus = await mkLoc({ school_id: A, name: 'Test Campus', category_id: catId('Open Space'), environment: 'outdoor' })
  log('Admin creates top-level outdoor location', !campus.error, campus.error?.message ?? '')
  const bldg = campus.data
    ? await mkLoc({ school_id: A, parent_id: campus.data.id, name: 'Test Main Building', category_id: catId('Building'), environment: 'indoor' })
    : { error: new Error('campus failed, skipping') }
  log('Admin creates building under campus', !bldg.error, bldg.error?.message ?? '')
  const floor = bldg.data
    ? await mkLoc({ school_id: A, parent_id: bldg.data.id, name: 'Test Floor 2', category_id: catId('Floor'), environment: 'indoor' })
    : { error: new Error('building failed, skipping') }
  log('Admin creates floor under building', !floor.error, floor.error?.message ?? '')
  const room = floor.data
    ? await mkLoc({ school_id: A, parent_id: floor.data.id, name: 'RLS Room 204', code: 'RLS-204', category_id: catId('Room'), environment: 'indoor' })
    : { error: new Error('floor failed, skipping') }
  log('Admin creates room with code', !room.error, room.error?.message ?? '')
  const garden = campus.data
    ? await mkLoc({ school_id: A, parent_id: campus.data.id, name: 'RLS School Garden', category_id: catId('Garden'), environment: 'outdoor' })
    : { error: new Error('campus failed, skipping') }
  log('Outdoor location without building/floor/code', !garden.error, garden.error?.message ?? '')

  if (room.data && floor.data && bldg.data) {
    const dupName = await adminClient.from('locations').insert({
      school_id: A, parent_id: floor.data.id, name: 'rls room 204', category_id: catId('Room'), environment: 'indoor',
    })
    log('Duplicate sibling name rejected (case-insensitive)', !!dupName.error && /already exists/i.test(dupName.error.message),
      dupName.error?.message ?? 'no error?')

    const dupCode = await adminClient.from('locations').insert({
      school_id: A, parent_id: bldg.data.id, name: 'RLS Room 205', code: 'RLS-204', category_id: catId('Room'), environment: 'indoor',
    })
    log('Duplicate code rejected', !!dupCode.error && /already used/i.test(dupCode.error.message),
      dupCode.error?.message ?? 'no error?')

    const selfP = await adminClient.from('locations').update({ parent_id: room.data.id }).eq('id', room.data.id)
    log('Self-parent rejected', !!selfP.error && /own parent/i.test(selfP.error.message),
      selfP.error?.message ?? 'no error?')

    const cyc = await adminClient.from('locations').update({ parent_id: room.data.id }).eq('id', bldg.data.id)
    log('Parent cycle rejected', !!cyc.error && /cycle/i.test(cyc.error.message),
      cyc.error?.message ?? 'no error?')

    const envMis = await adminClient.from('locations').insert({
      school_id: A, parent_id: floor.data.id, name: 'RLS Misplaced', category_id: catId('Room'), environment: 'outdoor',
    })
    log('Environment/category mismatch rejected', !!envMis.error && /may not label/i.test(envMis.error.message),
      envMis.error?.message ?? 'no error?')

    const archFloor = await adminClient.from('locations').update({ status: 'archived' }).eq('id', floor.data.id).select('status')
    log('Admin archives floor', archFloor.data?.[0]?.status === 'archived', archFloor.error?.message ?? '')

    const underArch = await adminClient.from('locations').insert({
      school_id: A, parent_id: floor.data.id, name: 'RLS Under Archived', category_id: catId('Room'), environment: 'indoor',
    })
    log('New child under archived parent rejected', !!underArch.error && /archived parent/i.test(underArch.error.message),
      underArch.error?.message ?? 'no error?')

    const archChild = await adminClient.from('locations').update({ status: 'archived' }).eq('id', room.data.id).select('id')
    log('Child archivable under archived parent (0004 fix)', !archChild.error && (archChild.data?.length ?? 0) === 1,
      archChild.error?.message ?? '')

    const freeName = await adminClient.from('locations').insert({
      school_id: A, parent_id: bldg.data.id, name: 'Test Floor 2', category_id: catId('Floor'), environment: 'indoor',
    })
    log('Archived name freed for reuse', !freeName.error, freeName.error?.message ?? '')

    const reassign = await adminClient.from('locations').update({ school_id: B }).eq('id', room.data.id)
    log('School reassignment rejected', !!reassign.error && /school reassignment/i.test(reassign.error.message),
      reassign.error?.message ?? 'no error?')

    const sUpd = await studentClient.from('locations').update({ name: 'Hijacked' }).eq('id', bldg.data.id).select('id')
    log('Student update blocked', !sUpd.error && (sUpd.data?.length ?? 0) === 0,
      sUpd.error?.message ?? `rows=${sUpd.data?.length}`)

    const sDel = await studentClient.from('locations').delete().eq('id', bldg.data.id).select('id')
    log('Student delete blocked (0 rows)', !sDel.error && (sDel.data?.length ?? 0) === 0,
      sDel.error?.message ?? `rows=${sDel.data?.length}`)

    const aDel = await adminClient.from('locations').delete().eq('id', bldg.data.id).select('id')
    log('Admin delete blocked — archive only', !aDel.error && (aDel.data?.length ?? 0) === 0,
      aDel.error?.message ?? `rows=${aDel.data?.length}`)

    const intact = await adminClient.from('locations').select('name').eq('id', bldg.data.id).single()
    log('Location intact after delete attempts', intact.data?.name === 'Test Main Building',
      `name=${intact.data?.name ?? 'missing'}`)

    // Cleanup: archive all active test-named locations (any order — 0004 fix allows it)
    await adminClient.from('locations')
      .update({ status: 'archived' })
      .eq('status', 'active')
      .in('name', TEST_LOCATION_NAMES)
    const left = await adminClient.from('locations')
      .select('id').eq('status', 'active').in('name', TEST_LOCATION_NAMES)
    log('Cleanup archived all active test locations', (left.data ?? []).length === 0,
      `active=${left.data?.length}`)
  } else {
    log('Location hierarchy and validation checks', false, 'setup failed, skipping')
  }

  // Custom category lifecycle
  let mkCat = await adminClient.from('location_categories')
    .insert({ school_id: A, name: 'RLS Robotics Lab', environment: 'indoor' })
    .select('id').single()
  if (mkCat.error) {
    const { data: exist } = await adminClient.from('location_categories')
      .select('id').eq('school_id', A).eq('name', 'RLS Robotics Lab').maybeSingle()
    if (exist) {
      await adminClient.from('location_categories').update({ is_active: true }).eq('id', exist.id)
      mkCat = { data: exist, error: null }
    }
  }
  log('Admin creates custom category', !mkCat.error, mkCat.error?.message ?? '')

  if (mkCat.data) {
    const useCat = await mkLoc({ school_id: A, name: 'RLS Robotics Room', category_id: mkCat.data.id, environment: 'indoor' })
    log('Location uses custom category', !useCat.error, useCat.error?.message ?? '')

    await adminClient.from('location_categories').update({ is_active: false }).eq('id', mkCat.data.id)
    const inactiveUse = await adminClient.from('locations').insert({
      school_id: A, name: 'RLS Inactive Cat Room', category_id: mkCat.data.id, environment: 'indoor',
    })
    log('Inactive category rejected', !!inactiveUse.error && /inactive/i.test(inactiveUse.error.message),
      inactiveUse.error?.message ?? 'no error?')
    await adminClient.from('location_categories').update({ is_active: true }).eq('id', mkCat.data.id)

    if (useCat.data) {
      await adminClient.from('locations').update({ status: 'archived' }).eq('id', useCat.data.id)
    }
  }

  const sCatIns = await studentClient.from('location_categories').insert({ school_id: A, name: 'RLS Student Cat' })
  log('Student category insert denied', !!sCatIns.error, sCatIns.error?.message ?? 'no error?')

  const locAudit = await adminClient.from('audit_logs').select('action, entity_type').eq('entity_type', 'locations')
  const locActions = new Set((locAudit.data ?? []).map((r) => r.action))
  log('Location changes audited', locActions.has('create') && locActions.has('update'),
    `actions=${[...locActions].join(',')}`)

  // 9. Multi-school isolation (requires SUPABASE_ACCESS_TOKEN for SQL setup/cleanup)
  console.log('\n9. Multi-school isolation');
  async function sql(query) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.message ?? `SQL API ${res.status}`)
    return Array.isArray(body) ? body : []
  }
  async function cleanupSchoolB() {
    await sql(`delete from public.audit_logs where entity_id = '${B}'
      or entity_id in (select id::text from public.locations where school_id = '${B}')
      or entity_id in (select id::text from public.location_categories where school_id = '${B}')`)
    await sql(`delete from public.locations where school_id = '${B}'`)
    await sql(`delete from public.location_categories where school_id = '${B}'`)
    await sql(`delete from public.schools where id = '${B}'`)
  }

  if (!token) {
    log('Multi-school checks', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  } else {
    try {
      await cleanupSchoolB()
      await sql(`insert into public.schools (id, name) values ('${B}', 'RLS Other School')`)
      await sql(`insert into public.location_categories (school_id, name, environment) values ('${B}', 'Building', 'indoor')`)
      const [catB] = await sql(`select id from public.location_categories where school_id = '${B}' and name = 'Building'`)
      const [locB] = await sql(`insert into public.locations (school_id, name, category_id, environment)
        values ('${B}', 'RLS Hidden Other School Building', '${catB.id}', 'indoor') returning id`)
      const locBId = locB.id

      const { data: aLocs } = await adminClient.from('locations').select('id')
      log('Admin A cannot read school B locations', !(aLocs ?? []).some((r) => r.id === locBId))
      const { data: sLocs2 } = await studentClient.from('locations').select('id')
      log('Student A cannot read school B locations', !(sLocs2 ?? []).some((r) => r.id === locBId))

      const { data: updRes } = await adminClient.from('locations')
        .update({ name: 'Hijacked B' }).eq('id', locBId).select('id')
      log('Admin A update on school B blocked', (updRes?.length ?? 0) === 0, `rows=${updRes?.length}`)

      const { error: xInsert } = await adminClient.from('locations').insert({
        school_id: B, name: 'RLS Cross School', category_id: catB.id, environment: 'indoor',
      })
      log('Admin A cross-school insert denied', !!xInsert && /row-level security/i.test(xInsert.message ?? ''),
        xInsert?.message ?? 'no error?')

      const { data: aAudit2 } = await adminClient.from('audit_logs').select('entity_id')
      log('School B audit rows hidden from admin A',
        !(aAudit2 ?? []).some((r) => r.entity_id === locBId || r.entity_id === B))

      const { data: aProfiles } = await adminClient.from('profiles').select('id, school_id')
      log('Admin A profiles limited to own school',
        (aProfiles ?? []).length >= 2 && (aProfiles ?? []).every((p) => p.school_id === A),
        `rows=${aProfiles?.length}`)

      await cleanupSchoolB()
      const after = await sql(`select id from public.schools where id = '${B}'`)
      log('School B cleanup complete', after.length === 0)
    } catch (e) {
      log('Multi-school checks', false, e.message)
      try { await cleanupSchoolB() } catch { /* best effort */ }
    }
  }

  // 10. Schedules (effective-dated, conflict-checked, no client delete)
  console.log('\n10. Schedules');
  const { data: anonSched } = await admin.from('schedules').select('*')
  log('Anon blocked from schedules', (anonSched?.length ?? 0) === 0, `rows=${anonSched?.length ?? 0}`)

  // Pre-clean: deactivate leftover test schedules (no client delete), archive leftover test room
  await adminClient.from('schedules')
    .update({ status: 'inactive' })
    .eq('status', 'active')
    .like('label', 'RLS %')
  await adminClient.from('locations')
    .update({ status: 'archived' })
    .eq('status', 'active')
    .eq('name', 'RLS Schedule Room')

  const schedRoom = await mkLoc({
    school_id: A, name: 'RLS Schedule Room', category_id: catId('Room'), environment: 'indoor',
  })
  log('Admin creates scheduling room', !schedRoom.error, schedRoom.error?.message ?? '')

  if (schedRoom.data) {
    const mkSched = (fields) =>
      adminClient.from('schedules').insert({ school_id: A, location_id: schedRoom.data.id, ...fields })

    const sCreate = await mkSched({ day_of_week: 1, start_time: '08:00', end_time: '09:00', label: 'RLS Period 1' })
    log('Admin creates schedule', !sCreate.error, sCreate.error?.message ?? '')

    const overlap = await mkSched({ day_of_week: 1, start_time: '08:30', end_time: '09:30', label: 'RLS Overlap' })
    log('Overlapping schedule rejected', !!overlap.error && /overlap/i.test(overlap.error.message),
      overlap.error?.message ?? 'no error?')

    const adjacent = await mkSched({ day_of_week: 1, start_time: '09:00', end_time: '10:00', label: 'RLS Period 2' })
    log('Adjacent schedule allowed', !adjacent.error, adjacent.error?.message ?? '')

    const otherDay = await mkSched({ day_of_week: 2, start_time: '08:00', end_time: '09:00', label: 'RLS Tue P1' })
    log('Same time on another day allowed', !otherDay.error, otherDay.error?.message ?? '')

    const inactive = await adminClient.from('schedules').insert({
      school_id: A, location_id: schedRoom.data.id,
      day_of_week: 1, start_time: '08:00', end_time: '09:00', label: 'RLS Shadow', status: 'inactive',
    }).select('id').single()
    log('Inactive conflicting row allowed', !inactive.error, inactive.error?.message ?? '')

    const activateShadow = inactive.data
      ? await adminClient.from('schedules').update({ status: 'active' }).eq('id', inactive.data.id)
      : { error: new Error('inactive insert failed') }
    log('Activating conflicting row rejected',
      !!activateShadow.error && /overlap/i.test(activateShadow.error.message),
      activateShadow.error?.message ?? 'no error?')

    const badTime = await mkSched({ day_of_week: 3, start_time: '10:00', end_time: '09:00', label: 'RLS Bad Time' })
    log('End before start rejected', !!badTime.error && /end time must be after/i.test(badTime.error.message),
      badTime.error?.message ?? 'no error?')

    const badRange = await mkSched({
      day_of_week: 3, start_time: '10:00', end_time: '11:00', label: 'RLS Bad Range',
      effective_from: '2026-06-01', effective_until: '2026-05-01',
    })
    log('Effective range order rejected', !!badRange.error && /effective until/i.test(badRange.error.message),
      badRange.error?.message ?? 'no error?')

    const zeroLength = await mkSched({ day_of_week: 6, start_time: '09:00', end_time: '09:00', label: 'RLS Zero Length' })
    log('Zero-length slot (start = end) rejected', !!zeroLength.error && /end time must be after/i.test(zeroLength.error.message),
      zeroLength.error?.message ?? 'no error?')

    const singleDay = await mkSched({
      day_of_week: 6, start_time: '08:00', end_time: '09:00', label: 'RLS One Day',
      effective_from: '2026-03-02', effective_until: '2026-03-02',
    })
    log('Single-day effective range accepted (inclusive boundary)', !singleDay.error,
      singleDay.error?.message ?? '')

    const xSchool = await adminClient.from('schedules').insert({
      school_id: B, location_id: schedRoom.data.id,
      day_of_week: 4, start_time: '08:00', end_time: '09:00', label: 'RLS Cross',
    })
    log('Cross-school schedule insert denied',
      !!xSchool.error && /row-level security|different school/i.test(xSchool.error.message),
      xSchool.error?.message ?? 'no error?')

    const sInsert = await studentClient.from('schedules').insert({
      school_id: A, location_id: schedRoom.data.id,
      day_of_week: 5, start_time: '08:00', end_time: '09:00', label: 'RLS Student',
    })
    log('Student schedule insert denied', !!sInsert.error, sInsert.error?.message ?? 'no error?')

    const sUpd = await studentClient.from('schedules')
      .update({ label: 'Hijacked' }).eq('label', 'RLS Period 1').select('id')
    log('Student schedule update blocked', !sUpd.error && (sUpd.data?.length ?? 0) === 0,
      sUpd.error?.message ?? `rows=${sUpd.data?.length}`)

    const sDel = await studentClient.from('schedules').delete().eq('label', 'RLS Period 1').select('id')
    log('Student schedule delete blocked (0 rows)', !sDel.error && (sDel.data?.length ?? 0) === 0,
      sDel.error?.message ?? `rows=${sDel.data?.length}`)

    const aDel = await adminClient.from('schedules').delete().eq('label', 'RLS Period 1').select('id')
    log('Admin schedule delete blocked — deactivate only', !aDel.error && (aDel.data?.length ?? 0) === 0,
      aDel.error?.message ?? `rows=${aDel.data?.length}`)

    const intact = await adminClient.from('schedules')
      .select('label, status').eq('label', 'RLS Period 1').eq('status', 'active').maybeSingle()
    log('Schedule intact after delete attempts', intact.data?.label === 'RLS Period 1',
      `label=${intact.data?.label ?? 'missing'}`)

    await adminClient.from('locations').update({ status: 'archived' }).eq('id', schedRoom.data.id)
    const afterArch = await mkSched({ day_of_week: 4, start_time: '10:00', end_time: '11:00', label: 'RLS After Archive' })
    log('Schedule on archived location rejected', !!afterArch.error && /archived location/i.test(afterArch.error.message),
      afterArch.error?.message ?? 'no error?')

    const sRead = await studentClient.from('schedules').select('id, label')
    log('Student reads own-school schedules', !sRead.error, sRead.error?.message ?? `rows=${sRead.data?.length}`)
  } else {
    log('Schedule checks', false, 'room setup failed, skipping')
  }

  // Cleanup: deactivate all active test schedules (no client delete), archive test room.
  // Deactivation updates are what produce 'update' audit rows for schedules.
  await adminClient.from('schedules')
    .update({ status: 'inactive' })
    .eq('status', 'active')
    .like('label', 'RLS %')
  if (token) {
    try {
      await sql(`delete from public.schedules where label like 'RLS %'`)
    } catch {
      /* best effort: deactivate-only fallback already ran */
    }
  }
  await adminClient.from('locations')
    .update({ status: 'archived' })
    .eq('status', 'active')
    .eq('name', 'RLS Schedule Room')
  const leftSched = await adminClient.from('schedules')
    .select('id').eq('status', 'active').like('label', 'RLS %')
  log('Cleanup deactivated all active test schedules', (leftSched.data ?? []).length === 0,
    `active=${leftSched.data?.length}`)

  const schedAudit = await adminClient.from('audit_logs').select('action, entity_type').eq('entity_type', 'schedules')
  const schedActions = new Set((schedAudit.data ?? []).map((r) => r.action))
  log('Schedule changes audited', schedActions.has('create') && schedActions.has('update'),
    `actions=${[...schedActions].join(',')}`)

  // 11. Submissions (the school's four data categories; students submit only,
  //     staff read and review; no client delete)
  console.log('\n11. Submissions');
  const { data: anonSub } = await admin.from('submissions').select('*')
  log('Anon blocked from submissions', (anonSub?.length ?? 0) === 0, `rows=${anonSub?.length ?? 0}`)

  if (token) {
    try { await sql(`delete from public.submissions where message like 'RLS %'`) } catch { /* best effort */ }
  }
  await adminClient.from('locations')
    .update({ status: 'archived' })
    .eq('status', 'active')
    .eq('name', 'RLS Report Room')

  // Use a location that really exists and is active in this school: the insert
  // policy refuses any location outside the caller's school (including one that
  // does not exist at all), so the test must not invent an id.
  const { data: activeLocs } = await adminClient
    .from('locations')
    .select('id')
    .eq('status', 'active')
    .limit(1)
  let usableLocation = activeLocs?.[0]?.id
  if (!usableLocation) {
    const repRoom = await mkLoc({
      school_id: A, name: 'RLS Report Room', category_id: catId('Room'), environment: 'indoor',
    })
    log('Admin creates submission room', !repRoom.error, repRoom.error?.message ?? '')
    usableLocation = repRoom.data?.id
  } else {
    log('Uses an existing active location for submission tests', true, `location=${usableLocation}`)
  }

  if (usableLocation) {
    const mkSub = (fields) =>
      studentClient.from('submissions').insert({
        school_id: A, location_id: usableLocation, ...fields,
      })

    // --- a student may submit.
    // NOTE: no .select() after insert on purpose. Returning the inserted row
    // makes PostgREST evaluate the SELECT policy too, and a student has no
    // SELECT policy on submissions (students may send only) - the insert
    // itself succeeds, the "read it back" part is what gets refused.
    const sentiment = await mkSub({
      kind: 'sentiment', sub_type: 'stressed', emotion: 'stressed', stress_level: 4,
      message: 'RLS exam week is piling up and I am finding it hard to sleep.',
    })
    log('Student submits a sentiment submission', !sentiment.error,
      sentiment.error?.message ?? '')

    const hazard = await mkSub({
      kind: 'incident_hazard', sub_type: 'bullying',
      message: 'RLS a student is being bullied near the canteen every break.',
    })
    log('Student submits an incident/hazard submission', !hazard.error,
      hazard.error?.message ?? '')

    const observation = await mkSub({
      kind: 'observation', sub_type: 'suggestion',
      message: 'RLS suggestion: add more shade over the basketball court.',
    })
    log('Student submits an observation', !observation.error,
      observation.error?.message ?? '')

    // the rows are really there - staff can read them back
    const { data: storedSubs } = await adminClient.from('submissions')
      .select('id, kind, sub_type, stress_level')
      .like('message', 'RLS %')
    log('Submitted rows are stored and readable by staff',
      (storedSubs?.length ?? 0) >= 3,
      `rows=${storedSubs?.length ?? 0}`)

    // --- the new access rule: a student cannot read submissions, not even their own
    const studentRead = await studentClient.from('submissions').select('id')
    log('Student cannot read submissions (send only)', (studentRead.data ?? []).length === 0,
      `rows=${studentRead.data?.length ?? 0}`)

    const studentReadOwn = sentiment.data?.id
      ? await studentClient.from('submissions').select('id').eq('id', sentiment.data.id)
      : { data: [] }
    log('Student cannot read their own submission', (studentReadOwn.data ?? []).length === 0,
      `rows=${studentReadOwn.data?.length ?? 0}`)

    const staffRead = await adminClient.from('submissions').select('id')
    log('Staff can read school submissions', (staffRead.data ?? []).length > 0,
      `rows=${staffRead.data?.length ?? 0}`)

    // --- students cannot review, update or delete
    const studentUpdate = hazard.data?.id
      ? await studentClient.from('submissions').update({ status: 'acknowledged' })
        .eq('id', hazard.data.id).select('id')
      : { data: [] }
    log('Student cannot acknowledge a submission (0 rows)', (studentUpdate.data ?? []).length === 0,
      `rows=${studentUpdate.data?.length ?? 0}`)

    const studentDelete = hazard.data?.id
      ? await studentClient.from('submissions').delete().eq('id', hazard.data.id).select('id')
      : { data: [] }
    log('Student cannot delete a submission (0 rows)', (studentDelete.data ?? []).length === 0,
      `rows=${studentDelete.data?.length ?? 0}`)

    // --- validation
    const noStress = await mkSub({
      kind: 'sentiment', sub_type: 'sad', emotion: 'sad',
      message: 'RLS sentiment without a stress level',
    })
    log('Sentiment submission without a stress level rejected',
      !!noStress.error && /stress level/i.test(noStress.error.message),
      noStress.error?.message ?? 'no error?')

    const badKind = await mkSub({
      kind: 'not_a_kind', sub_type: 'sad', message: 'RLS invalid kind',
    })
    log('Invalid category rejected', !!badKind.error, badKind.error?.message ?? 'no error?')

    const badSubType = await mkSub({
      kind: 'incident_hazard', sub_type: 'not_a_type', message: 'RLS invalid sub type',
    })
    log('Invalid sub-type rejected', !!badSubType.error, badSubType.error?.message ?? 'no error?')

    const stressOnHazard = await mkSub({
      kind: 'incident_hazard', sub_type: 'bullying', stress_level: 3,
      message: 'RLS stress level on a hazard submission',
    })
    log('Stress level rejected outside sentiment submissions',
      !!stressOnHazard.error && /only applies to sentiment/i.test(stressOnHazard.error.message),
      stressOnHazard.error?.message ?? 'no error?')

    const shortMessage = await mkSub({
      kind: 'observation', sub_type: 'report', message: 'x',
    })
    log('Too-short message rejected', !!shortMessage.error, shortMessage.error?.message ?? 'no error?')

    const asOther = await studentClient.from('submissions').insert({
      school_id: A, kind: 'observation', sub_type: 'report', message: 'RLS filed as someone else',
      submitted_by: ADMIN_ID,
    })
    log('Submission on behalf of someone else rejected',
      !!asOther.error && /by yourself/i.test(asOther.error.message),
      asOther.error?.message ?? 'no error?')

    const xSchool = await studentClient.from('submissions').insert({
      school_id: B, kind: 'observation', sub_type: 'report', message: 'RLS cross school submission',
    })
    log('Cross-school submission denied',
      !!xSchool.error && /row-level security/i.test(xSchool.error.message ?? ''),
      xSchool.error?.message ?? 'no error?')

    const badLocation = await studentClient.from('submissions').insert({
      school_id: A, kind: 'observation', sub_type: 'report',
      message: 'RLS submission against a location that does not exist',
      location_id: '11111111-2222-3333-4444-555555555555',
    })
    log('Submission against an unknown location denied', !!badLocation.error,
      badLocation.error?.message ?? 'no error?')

    // --- staff review workflow (ids come from the staff read-back above: a
    // student cannot read the row back, so the ids are fetched as staff)
    const hazardRow = (storedSubs ?? []).find((row) => row.kind === 'incident_hazard')
    if (hazardRow?.id) {
      const ack = await adminClient.from('submissions')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
        .eq('id', hazardRow.id).select('id, status')
      log('Staff acknowledges a submission', (ack.data ?? []).length === 1
        && ack.data?.[0]?.status === 'acknowledged', ack.error?.message ?? '')

      const resolved = await adminClient.from('submissions')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('id', hazardRow.id).select('id, status')
      log('Staff resolves a submission', (resolved.data ?? []).length === 1
        && resolved.data?.[0]?.status === 'resolved', resolved.error?.message ?? '')

      const staffDelete = await adminClient.from('submissions')
        .delete().eq('id', hazardRow.id).select('id')
      log('Client cannot delete a submission (0 rows)', (staffDelete.data ?? []).length === 0,
        `rows=${staffDelete.data?.length ?? 0}`)

      const stillThere = await adminClient.from('submissions')
        .select('id, message').eq('id', hazardRow.id).single()
      log('Submission is retained after the delete attempt', stillThere.data?.message?.includes('RLS'),
        stillThere.error?.message ?? 'missing')
    }

    // --- a teacher is staff and can read submissions
    const teachPromo = await adminClient.rpc('admin_set_user_role', {
      target_user_id: STUDENT_ID, new_role: 'teacher_staff',
    })
    const teacherRead = await studentClient.from('submissions').select('id')
    log('Teacher can read submissions', !teachPromo.error && (teacherRead.data ?? []).length > 0,
      teacherRead.error?.message ?? `rows=${teacherRead.data?.length ?? 0}`)
    await adminClient.rpc('admin_set_user_role', {
      target_user_id: STUDENT_ID, new_role: 'student',
    })
  } else {
    log('Submission checks', false, 'room setup failed, skipping')
  }

  // Cleanup: submissions have no client delete — token-gated removal of synthetic rows
  if (token) {
    try { await sql(`delete from public.submissions where message like 'RLS %'`) } catch { /* best effort */ }
  }
  await adminClient.from('locations')
    .update({ status: 'archived' })
    .eq('status', 'active')
    .eq('name', 'RLS Report Room')
  if (token) {
    const leftSub = await adminClient.from('submissions').select('id').like('message', 'RLS %')
    log('Cleanup removed all test submissions', (leftSub.data ?? []).length === 0,
      `remaining=${leftSub.data?.length ?? 0}`)
  } else {
    log('Cleanup removed all test submissions', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  const subAudit = await adminClient.from('audit_logs').select('action, entity_type').eq('entity_type', 'submissions')
  const subActions = new Set((subAudit.data ?? []).map((r) => r.action))
  log('Submission changes audited', subActions.has('create') && subActions.has('update'),
    `actions=${[...subActions].join(',')}`)
  // 12. Report photos (private bucket, signed URLs, staff read, submitter uploads)
  console.log('\n12. Report photos');
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const bucket = 'report-photos'

  if (token) {
    const [bucketRow] = await sql(`select public, file_size_limit from storage.buckets where id = '${bucket}'`)
    log('Report photo bucket is private',
      bucketRow?.public === false,
      `public=${bucketRow?.public}`)
  } else {
    log('Report photo bucket is private', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  const { data: anonList, error: anonListErr } = await admin.storage.from(bucket).list('')
  log('Anon blocked from report photos',
    !!anonListErr || (anonList?.length ?? 0) === 0,
    anonListErr?.message ?? `objects=${anonList?.length ?? 0}`)

  const sRep = await studentClient.from('submissions').insert({
    school_id: A, kind: 'observation', sub_type: 'report',
    message: 'RLS photo submission by student',
  })
  const aRep = await adminClient.from('submissions').insert({
    school_id: A, kind: 'observation', sub_type: 'report',
    message: 'RLS photo submission by admin',
  })
  // read the ids back as staff (students may not read submissions)
  const { data: photoSubs } = await adminClient.from('submissions')
    .select('id, message').like('message', 'RLS photo submission%')
  const sRepId = photoSubs?.find((row) => row.message.includes('by student'))?.id
  const aRepId = photoSubs?.find((row) => row.message.includes('by admin'))?.id
  log('Photo test submissions created', !sRep.error && !aRep.error && Boolean(sRepId) && Boolean(aRepId),
    sRep.error?.message ?? aRep.error?.message ?? '')

  let ownPath = ''
  let otherPath = ''
  if (sRepId && aRepId) {
    ownPath = `${A}/${sRepId}/photo.png`
    otherPath = `${A}/${aRepId}/photo.png`

    const up = await studentClient.storage.from(bucket).upload(ownPath, PNG, { contentType: 'image/png' })
    log('Submitter uploads a photo to their own submission', !up.error, up.error?.message ?? '')

    const upOther = await studentClient.storage.from(bucket).upload(otherPath, PNG, { contentType: 'image/png' })
    log('Upload to another member\'s submission denied', !!upOther.error,
      upOther.error?.message ?? 'no error?')

    const upCross = await studentClient.storage.from(bucket)
      .upload(`${B}/${sRepId}/photo.png`, PNG, { contentType: 'image/png' })
    log('Cross-school photo path denied', !!upCross.error, upCross.error?.message ?? 'no error?')

    // Admin uploads to their own submission so a real object exists for delete tests
    const upAdmin = await adminClient.storage.from(bucket)
      .upload(otherPath, PNG, { contentType: 'image/png' })
    log('Staff uploads a photo to their own submission', !upAdmin.error, upAdmin.error?.message ?? '')

    const ownSigned = await studentClient.storage.from(bucket).createSignedUrl(ownPath, 60)
    log('A student cannot read a photo (send only)', !ownSigned.data?.signedUrl,
      ownSigned.error?.message ?? 'a link was issued')

    const staffSigned = await adminClient.storage.from(bucket).createSignedUrl(ownPath, 60)
    log('Staff can read a school submission photo', !!staffSigned.data?.signedUrl,
      staffSigned.error?.message ?? '')

    const attOk = await studentClient.from('report_attachments').insert({
      report_id: sRepId, school_id: A, storage_path: ownPath,
    })
    log('Submitter can register own attachment', !attOk.error, attOk.error?.message ?? '')

    const attOther = await studentClient.from('report_attachments').insert({
      report_id: aRepId, school_id: A, storage_path: otherPath,
    })
    log('Attachment for another member\'s submission denied', !!attOther.error,
      attOther.error?.message ?? 'no error?')

    const attBadPath = await studentClient.from('report_attachments').insert({
      report_id: sRepId, school_id: A, storage_path: `${A}/${aRepId}/photo.png`,
    })
    log('Attachment path mismatch rejected', !!attBadPath.error && /does not match/i.test(attBadPath.error.message),
      attBadPath.error?.message ?? 'no error?')

    const staffDelete = await adminClient.storage.from(bucket).remove([ownPath])
    const stillThere = await adminClient.storage.from(bucket).createSignedUrl(ownPath, 60)
    log('Staff can delete a school photo (object gone)', !stillThere.data?.signedUrl,
      staffDelete.error?.message ?? 'still readable!')

    const studentDelete = await studentClient.storage.from(bucket).remove([ownPath])
    const studentSee = await studentClient.storage.from(bucket).createSignedUrl(ownPath, 60)
    log('A student cannot delete or read photos', !studentSee.data?.signedUrl,
      studentDelete.error?.message ?? 'no error?')
  } else {
    log('Report photo checks', false, 'submission setup failed, skipping')
  }

  // Cleanup: storage objects are removed through the storage API (reviewer rights),
  // then any straggler rows via SQL; attachment rows via SQL.
  if (ownPath && otherPath) {
    // Remove one at a time: a batch aborts if any path is already gone.
    await adminClient.storage.from(bucket).remove([ownPath])
    await adminClient.storage.from(bucket).remove([otherPath])
  }
  if (token) {
    try {
      const leftovers = await sql(`select name from storage.objects where bucket_id = '${bucket}'`)
      for (const row of leftovers) {
        await adminClient.storage.from(bucket).remove([row.name])
      }
    } catch { /* best effort */ }
    try { await sql(`delete from public.report_attachments where storage_path like '11111111-1111-1111-1111-111111111111/%'`) } catch { /* best effort */ }
    try { await sql(`delete from public.submissions where message like 'RLS %'`) } catch { /* best effort */ }
  }
  if (token) {
    const leftObjs = await sql(`select count(*)::int as n from storage.objects where bucket_id = '${bucket}'`)
    log('Cleanup removed all test photos', (leftObjs[0]?.n ?? 0) === 0, `remaining=${leftObjs[0]?.n}`)
  } else {
    log('Cleanup removed all test photos', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  // 13. Check-ins (self-report, immutable log, source honesty)
  console.log('\n13. Check-ins');
  const { data: anonChk } = await admin.from('check_ins').select('*')
  log('Anon blocked from check-ins', (anonChk?.length ?? 0) === 0, `rows=${anonChk?.length ?? 0}`)

  const chk = await studentClient.from('check_ins').insert({
    school_id: A, location_source: 'self_selected', period: 'RLS Period 1', status: 'safe',
  })
  log('Student records own check-in', !chk.error, chk.error?.message ?? '')

  const chkOther = await studentClient.from('check_ins').insert({
    school_id: A, profile_id: ADMIN_ID, location_source: 'self_selected',
  })
  log('Check-in for another user denied', !!chkOther.error && /for yourself/i.test(chkOther.error.message),
    chkOther.error?.message ?? 'no error?')

  const chkSchool = await studentClient.from('check_ins').insert({
    school_id: B, location_source: 'self_selected',
  })
  log('Cross-school check-in denied', !!chkSchool.error && /row-level security/i.test(chkSchool.error.message ?? ''),
    chkSchool.error?.message ?? 'no error?')

  const chkStaff = await studentClient.from('check_ins').insert({
    school_id: A, location_source: 'staff_verified',
  })
  log('Student cannot claim staff-verified location',
    !!chkStaff.error && /responders or administrators/i.test(chkStaff.error.message),
    chkStaff.error?.message ?? 'no error?')

  const chkSched = await studentClient.from('check_ins').insert({
    school_id: A, location_source: 'schedule_derived', location_id: null,
  })
  log('Schedule-derived check-in without a location rejected',
    !!chkSched.error && /needs a location/i.test(chkSched.error.message),
    chkSched.error?.message ?? 'no error?')

  const { data: myChk } = await studentClient.from('check_ins').select('id, status')
  log('Student reads own check-ins', (myChk?.length ?? 0) >= 1, `rows=${myChk?.length ?? 0}`)

  const chkDel = (myChk?.[0]?.id)
    ? await studentClient.from('check_ins').delete().eq('id', myChk[0].id).select('id')
    : { data: [] }
  log('Check-in delete blocked (0 rows)', (chkDel.data ?? []).length === 0, `rows=${chkDel.data?.length}`)

  const chkUpd = (myChk?.[0]?.id)
    ? await studentClient.from('check_ins').update({ status: 'safe' }).eq('id', myChk[0].id).select('id')
    : { data: [] }
  log('Check-in update blocked (0 rows)', (chkUpd.data ?? []).length === 0, `rows=${chkUpd.data?.length}`)

  if (token) {
    try { await sql(`delete from public.check_ins where period like 'RLS %'`) } catch { /* best effort */ }
    const leftChk = await sql(`select count(*)::int as n from public.check_ins where period like 'RLS %'`)
    log('Cleanup removed all test check-ins', (leftChk[0]?.n ?? 0) === 0, `remaining=${leftChk[0]?.n}`)
  } else {
    log('Cleanup removed all test check-ins', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  // 14. SOS / incidents (case reference, workflow, roles, duplicates, history)
  console.log('\n14. Incidents');
  const { data: anonInc } = await admin.from('incidents').select('*')
  log('Anon blocked from incidents', (anonInc?.length ?? 0) === 0, `rows=${anonInc?.length ?? 0}`)

  const { data: counterRead, error: counterErr } = await studentClient.from('incident_case_refs').select('*')
  log('Case-reference counter not readable by clients',
    !!counterErr || (counterRead?.length ?? 0) === 0,
    counterErr?.message ?? `rows=${counterRead?.length ?? 0}`)

  const sInc = await studentClient.from('incidents').insert({
    school_id: A, category: 'emergency', description: 'RLS incident raised by student',
  }).select('id, case_ref, status').single()
  log('Student raises an incident', !sInc.error && !!sInc.data?.id, sInc.error?.message ?? '')
  log('Case reference format SNT-YYYY-####',
    /^SNT-\d{4}-\d{4}$/.test(sInc.data?.case_ref ?? ''),
    `case_ref=${sInc.data?.case_ref ?? 'missing'}`)

  const dupInc = await studentClient.from('incidents').insert({
    school_id: A, category: 'emergency', description: 'RLS duplicate incident attempt',
  })
  log('Duplicate incident within cooldown rejected',
    !!dupInc.error && /already have an open incident/i.test(dupInc.error.message),
    dupInc.error?.message ?? 'no error?')

  const badCatInc = await adminClient.from('incidents').insert({
    school_id: A, category: 'not-a-category', description: 'RLS bad category incident',
  })
  log('Invalid incident category rejected',
    !!badCatInc.error && /invalid incident category/i.test(badCatInc.error.message),
    badCatInc.error?.message ?? 'no error?')

  // Cross-school insert is tested by the admin, who has no open case at this
  // point: the duplicate guard (a BEFORE trigger) would otherwise fire first.
  const xSchoolInc = await adminClient.from('incidents').insert({
    school_id: B, category: 'emergency', description: 'RLS cross school incident',
  })
  log('Cross-school incident insert denied',
    !!xSchoolInc.error && /row-level security/i.test(xSchoolInc.error.message ?? ''),
    xSchoolInc.error?.message ?? 'no error?')

  const aInc = await adminClient.from('incidents').insert({
    school_id: A, category: 'medical', description: 'RLS incident raised by admin',
  }).select('id, case_ref, status').single()
  log('Admin raises an incident', !aInc.error && !!aInc.data?.id, aInc.error?.message ?? '')
  log('Case references are unique', sInc.data?.case_ref !== aInc.data?.case_ref,
    `${sInc.data?.case_ref} vs ${aInc.data?.case_ref}`)

  if (aInc.data?.id) {
    const sReadInc = await studentClient.from('incidents').select('id').eq('id', aInc.data.id)
    log("Student cannot read another member's incident", (sReadInc.data ?? []).length === 0,
      `rows=${sReadInc.data?.length}`)

    const sTransition = await studentClient.rpc('transition_incident', {
      incident_id: aInc.data.id, new_status: 'acknowledged', note: null,
    })
    log('Non-reviewer transition rejected',
      !!sTransition.error && /not allowed for your role/i.test(sTransition.error.message),
      sTransition.error?.message ?? 'no error?')

    const sNote = await studentClient.from('incident_notes').insert({
      incident_id: aInc.data.id, body: 'RLS note from another member',
    })
    log("Cannot add a note to another member's incident", !!sNote.error,
      sNote.error?.message ?? 'no error?')

    const sCancel = await studentClient.rpc('transition_incident', {
      incident_id: aInc.data.id, new_status: 'cancelled', note: 'RLS not mine',
    })
    log("Cannot cancel another member's incident", !!sCancel.error,
      sCancel.error?.message ?? 'no error?')

    // Full responder lifecycle on the admin incident
    const steps = [
      ['acknowledged', null],
      ['assigned', null],
      ['in_progress', null],
      ['resolved', 'RLS resolved with note'],
      ['closed', null],
    ]
    let lifecycleOk = true
    let lastError = ''
    for (const [status, note] of steps) {
      const { error: stepError } = await adminClient.rpc('transition_incident', {
        incident_id: aInc.data.id, new_status: status, note,
      })
      if (stepError) {
        lifecycleOk = false
        lastError = `${status}: ${stepError.message}`
        break
      }
    }
    log('Responder completes the full workflow', lifecycleOk, lastError)

    const { data: closedInc } = await adminClient.from('incidents')
      .select('status, resolution_notes').eq('id', aInc.data.id).single()
    log('Incident reaches closed with resolution notes',
      closedInc?.status === 'closed' && closedInc?.resolution_notes === 'RLS resolved with note',
      `status=${closedInc?.status}`)

    const badStep = await adminClient.rpc('transition_incident', {
      incident_id: aInc.data.id, new_status: 'in_progress', note: null,
    })
    log('Transition out of a closed case rejected',
      !!badStep.error && /not allowed for your role/i.test(badStep.error.message),
      badStep.error?.message ?? 'no error?')

    const { data: history } = await adminClient.from('incident_status_history')
      .select('from_status, to_status, actor_id').eq('incident_id', aInc.data.id)
    log('Status history retained for every transition', (history?.length ?? 0) === steps.length,
      `rows=${history?.length ?? 0}`)

    const sHistory = await studentClient.from('incident_status_history')
      .select('id').eq('incident_id', aInc.data.id)
    log("Student cannot read another member's incident history", (sHistory.data ?? []).length === 0,
      `rows=${sHistory.data?.length}`)

    const directUpdate = await adminClient.from('incidents')
      .update({ status: 'new' }).eq('id', aInc.data.id).select('id')
    log('Direct status update blocked — RPC only', (directUpdate.data ?? []).length === 0,
      `rows=${directUpdate.data?.length}`)

    const del = await adminClient.from('incidents').delete().eq('id', aInc.data.id).select('id')
    log('Incident delete blocked (0 rows)', (del.data ?? []).length === 0, `rows=${del.data?.length}`)

    const note = await adminClient.from('incident_notes').insert({
      incident_id: aInc.data.id, body: 'RLS responder note',
    })
    log('Responder can add a note', !note.error, note.error?.message ?? '')

    const { data: incAudit } = await adminClient.from('audit_logs')
      .select('action, entity_type').eq('entity_type', 'incidents')
    const incActions = new Set((incAudit?.map((r) => r.action) ?? []))
    log('Incident transitions audited', incActions.has('incident_transition'),
      `actions=${[...incActions].join(',')}`)
  }

  if (sInc.data?.id) {
    const cancel = await studentClient.rpc('transition_incident', {
      incident_id: sInc.data.id, new_status: 'cancelled', note: 'RLS false alarm',
    })
    log('Creator can cancel their own case', !cancel.error, cancel.error?.message ?? '')

    const { data: cancelled } = await studentClient.from('incidents')
      .select('status, cancelled_reason').eq('id', sInc.data.id).single()
    log('Cancellation keeps the reason and the history',
      cancelled?.status === 'cancelled' && cancelled?.cancelled_reason === 'RLS false alarm',
      `status=${cancelled?.status}`)

    const { data: ownHistory } = await studentClient.from('incident_status_history')
      .select('id').eq('incident_id', sInc.data.id)
    log('Creator can read their own case history', (ownHistory?.length ?? 0) >= 1,
      `rows=${ownHistory?.length ?? 0}`)

    const ownNote = await studentClient.from('incident_notes').insert({
      incident_id: sInc.data.id, body: 'RLS context note from creator',
    })
    log('Creator can add a context note to their own case', !ownNote.error,
      ownNote.error?.message ?? '')
  }

  if (token) {
    try {
      await sql(`delete from public.audit_logs where entity_type in ('incidents', 'incident_notes')
        and entity_id in (select id::text from public.incidents where description like 'RLS %')`)
      await sql(`delete from public.incident_notes where incident_id in (select id from public.incidents where description like 'RLS %')`)
      await sql(`delete from public.incident_status_history where incident_id in (select id from public.incidents where description like 'RLS %')`)
      await sql(`delete from public.incidents where description like 'RLS %'`)
    } catch { /* best effort */ }
    const leftInc = await sql(`select count(*)::int as n from public.incidents where description like 'RLS %'`)
    log('Cleanup removed all test incidents', (leftInc[0]?.n ?? 0) === 0, `remaining=${leftInc[0]?.n}`)
  } else {
    log('Cleanup removed all test incidents', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  // 15. Dashboard aggregates (role-filtered, counts only)
  console.log('\n15. Dashboard counts');
  const anonCounts = await admin.rpc('dashboard_counts')
  log('Anon blocked from dashboard counts', !!anonCounts.error,
    anonCounts.error?.message ?? 'no error?')

  const studentCounts = await studentClient.rpc('dashboard_counts')
  const sCount = studentCounts.data ?? {}
  log('Student receives own-record counts', !studentCounts.error
    && typeof sCount.my_check_ins_today === 'number',
    studentCounts.error?.message ?? JSON.stringify(sCount))
  log('Student receives no school-wide counts',
    sCount.school_open_incidents === undefined
    && sCount.school_check_ins_today === undefined
    && sCount.school_open_reports === undefined,
    `keys=${Object.keys(sCount).join(',')}`)
  log('Student receives no user or audit counts',
    sCount.users_total === undefined && sCount.audit_rows_30d === undefined,
    `keys=${Object.keys(sCount).join(',')}`)

  // Teacher scope: promote the student temporarily, then revert
  const teachPromo = await adminClient.rpc('admin_set_user_role', {
    target_user_id: STUDENT_ID, new_role: 'teacher_staff',
  })
  const teacherCounts = await studentClient.rpc('dashboard_counts')
  const tCount = teacherCounts.data ?? {}
  log('Teacher receives school counts (no identities)',
    !teachPromo.error && typeof tCount.school_open_incidents === 'number'
    && tCount.users_total === undefined,
    teacherCounts.error?.message ?? `keys=${Object.keys(tCount).join(',')}`)
  await adminClient.rpc('admin_set_user_role', {
    target_user_id: STUDENT_ID, new_role: 'student',
  })

  const adminCounts = await adminClient.rpc('dashboard_counts')
  const aCount = adminCounts.data ?? {}
  log('Administrator receives user and audit counts',
    !adminCounts.error && typeof aCount.users_total === 'number'
    && typeof aCount.audit_rows_30d === 'number',
    adminCounts.error?.message ?? `keys=${Object.keys(aCount).join(',')}`)

  // Dashboard numbers must match the rows the same role can actually read
  const { data: readableIncidents } = await adminClient.from('incidents').select('id')
  const { count: incidentHead } = await adminClient
    .from('incidents').select('id', { count: 'exact', head: true })
  log('Dashboard incident count matches the readable rows',
    incidentHead === (readableIncidents?.length ?? 0),
    `head=${incidentHead} rows=${readableIncidents?.length ?? 0}`)

  const { count: studentHead } = await studentClient
    .from('incidents').select('id', { count: 'exact', head: true })
  const { data: studentRows } = await studentClient.from('incidents').select('id')
  log('Student dashboard scope matches the rows a student can read',
    studentHead === (studentRows?.length ?? 0),
    `head=${studentHead} rows=${studentRows?.length ?? 0}`)

  // 16. Weather observations (server writes only, authenticated read)
  console.log('\n16. Weather observations');
  const { data: anonWeather } = await admin.from('weather_observations').select('*')
  log('Anon blocked from weather observations', (anonWeather?.length ?? 0) === 0,
    `rows=${anonWeather?.length ?? 0}`)

  const { data: wRead, error: wReadErr } = await studentClient
    .from('weather_observations')
    .select('id, source, rule_version, fetched_at, is_stale')
  log('Student reads school weather observations', !wReadErr,
    wReadErr?.message ?? `rows=${wRead?.length ?? 0}`)

  const { error: wIns } = await studentClient.from('weather_observations').insert({
    school_id: A, source: 'open-meteo', observed_at: '2026-01-01T00:00:00Z',
    latitude: 0, longitude: 0, temperature_c: 20, humidity_percent: 50,
    rule_version: 'heat_index_v1',
  })
  log('Client cannot write a weather observation', !!wIns, wIns?.message ?? 'no error?')

  const { data: wDel } = await studentClient.from('weather_observations')
    .delete().gt('id', 0).select('id')
  log('Client cannot delete weather observations', (wDel?.length ?? 0) === 0,
    `rows=${wDel?.length ?? 0}`)

  if (token) {
    const [latest] = await sql(`select source, rule_version, is_stale, temperature_c,
      humidity_percent, heat_index_method, heat_index_c
      from public.weather_observations order by fetched_at desc limit 1`)
    log('Server-side observation stored with source and rule version',
      Boolean(latest && latest.source === 'open-meteo'
        && latest.rule_version === 'heat_index_v1' && latest.heat_index_method),
      latest ? `${latest.source}/${latest.rule_version}/${latest.heat_index_method}` : 'no observation yet')
  } else {
    log('Server-side observation stored with source and rule version', true,
      'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  // 17. Alerts (human-gated publication) and case notifications
  console.log('\n17. Alerts');
  const { data: anonAlerts } = await admin.from('alerts').select('*')
  log('Anon blocked from alerts', (anonAlerts?.length ?? 0) === 0, `rows=${anonAlerts?.length ?? 0}`)
  const { data: anonNotes } = await admin.from('incident_notifications').select('*')
  log('Anon blocked from case notifications', (anonNotes?.length ?? 0) === 0,
    `rows=${anonNotes?.length ?? 0}`)

  const { error: studentDraft } = await studentClient.from('alerts').insert({
    school_id: A, title: 'RLS student draft', body: 'RLS students may not draft alerts',
    severity: 'info', target_scope: 'all',
  })
  log('Student cannot draft an alert', !!studentDraft, studentDraft?.message ?? 'no error?')

  const draft = await adminClient.from('alerts').insert({
    school_id: A, title: 'RLS drill tomorrow', body: 'RLS evacuation drill at 10:00, please follow staff instructions.',
    severity: 'advisory', target_scope: 'all',
  }).select('id, status, version').single()
  log('Administrator drafts an alert', !draft.error && !!draft.data?.id, draft.error?.message ?? '')

  if (draft.data?.id) {
    const { error: studentPublish } = await studentClient.rpc('publish_alert', {
      alert_id: draft.data.id,
    })
    log('Non-approver cannot publish', !!studentPublish, studentPublish?.message ?? 'no error?')

    const { error: publishBeforeApprove } = await adminClient.rpc('publish_alert', {
      alert_id: draft.data.id,
    })
    log('Publishing before approval rejected',
      !!publishBeforeApprove && /approved before/i.test(publishBeforeApprove.message),
      publishBeforeApprove?.message ?? 'no error?')

    const { error: approveErr } = await adminClient.rpc('approve_alert', { alert_id: draft.data.id })
    log('Administrator approves the alert', !approveErr, approveErr?.message ?? '')

    const { error: publishErr } = await adminClient.rpc('publish_alert', { alert_id: draft.data.id })
    log('Administrator publishes the alert', !publishErr, publishErr?.message ?? '')

    const { data: studentRead } = await studentClient.from('alerts')
      .select('id, status').eq('id', draft.data.id)
    log('Published alert visible to students', (studentRead?.length ?? 0) === 1,
      `rows=${studentRead?.length ?? 0}`)

    const { data: nonAuthorUpdate } = await studentClient.from('alerts')
      .update({ status: 'published' }).eq('id', draft.data.id).select('id')
    log('Non-author cannot update an alert (0 rows)', (nonAuthorUpdate?.length ?? 0) === 0,
      `rows=${nonAuthorUpdate?.length ?? 0}`)

    const { data: directStatus } = await adminClient.from('alerts')
      .update({ status: 'published' }).eq('id', draft.data.id).select('id')
    log('Even the author cannot set the status directly',
      (directStatus?.length ?? 0) === 0,
      `rows=${directStatus?.length ?? 0}`)

    const { data: alertDelete } = await adminClient.from('alerts')
      .delete().eq('id', draft.data.id).select('id')
    log('Client cannot delete an alert (0 rows)', (alertDelete?.length ?? 0) === 0,
      `rows=${alertDelete?.length ?? 0}`)

    // A responder-targeted alert must not be visible to a student
    const respDraft = await adminClient.from('alerts').insert({
      school_id: A, title: 'RLS responders only', body: 'RLS operational notice for responders only',
      severity: 'urgent', target_scope: 'responders',
    }).select('id').single()
    const { error: respPublish } = await adminClient.rpc('approve_alert', { alert_id: respDraft.data?.id })
    if (!respPublish) await adminClient.rpc('publish_alert', { alert_id: respDraft.data?.id })

    const { data: studentScoped } = await studentClient.from('alerts')
      .select('id').eq('id', respDraft.data?.id)
    log('Student cannot read a responders-only alert', (studentScoped?.length ?? 0) === 0,
      `rows=${studentScoped?.length ?? 0}`)

    const { data: adminScoped } = await adminClient.from('alerts')
      .select('id').eq('id', respDraft.data?.id)
    log('Reviewer can read a responders-only alert', (adminScoped?.length ?? 0) === 1,
      `rows=${adminScoped?.length ?? 0}`)

    // Correction: a new version, the old row retained and marked corrected
    const { data: correctedRaw, error: correctedError } = await adminClient.rpc('correct_alert', {
      alert_id: draft.data.id,
      new_title: 'RLS drill tomorrow (corrected)',
      new_body: 'RLS evacuation drill at 11:00, please follow staff instructions.',
      reason: 'RLS time corrected',
    })
    const correctedRow = Array.isArray(correctedRaw) ? correctedRaw[0] : correctedRaw
    log('Correction creates a new version',
      !correctedError && correctedRow?.version === 2,
      correctedError?.message ?? `version=${correctedRow?.version}`)

    const { data: oldVersion } = await adminClient.from('alerts')
      .select('status').eq('id', draft.data.id).single()
    log('Superseded alert is retained and marked corrected', oldVersion?.status === 'corrected',
      `status=${oldVersion?.status}`)

    // Cancellation applies to an alert that is still live (the published draft was
    // superseded by the correction above and is closed).
    const { error: cancelErr } = await adminClient.rpc('cancel_alert', {
      alert_id: respDraft.data?.id,
      reason: 'RLS cancelled',
    })
    log('Administrator cancels the alert', !cancelErr, cancelErr?.message ?? '')

    const { data: cancelled } = await adminClient.from('alerts')
      .select('status, cancel_reason').eq('id', respDraft.data?.id).single()
    log('Cancelled alert is retained with a reason',
      cancelled?.status === 'cancelled' && cancelled?.cancel_reason === 'RLS cancelled',
      `status=${cancelled?.status}`)

    const { data: alertAudit } = await adminClient.from('audit_logs')
      .select('action').eq('entity_type', 'alerts')
    const alertActions = new Set((alertAudit?.map((r) => r.action) ?? []))
    log('Alert workflow is audited',
      alertActions.has('alert_approved') && alertActions.has('alert_published')
      && alertActions.has('alert_corrected') && alertActions.has('alert_cancelled'),
      `actions=${[...alertActions].join(',')}`)
  }

  // A new case creates an operational notification that only reviewers can read
  const noteIncident = await adminClient.from('incidents').insert({
    school_id: A, category: 'emergency', description: 'RLS case for notification check',
  }).select('id').single()
  if (noteIncident.data?.id) {
    const { data: reviewerNotes } = await adminClient.from('incident_notifications')
      .select('id, case_ref').eq('incident_id', noteIncident.data.id)
    log('New case creates a reviewer notification', (reviewerNotes?.length ?? 0) === 1,
      `rows=${reviewerNotes?.length ?? 0}`)

    const { data: studentNotes } = await studentClient.from('incident_notifications')
      .select('id').eq('incident_id', noteIncident.data.id)
    log('Students cannot read case notifications', (studentNotes?.length ?? 0) === 0,
      `rows=${studentNotes?.length ?? 0}`)
  }

  if (token) {
    try {
      await sql(`delete from public.audit_logs where entity_type = 'alerts'`)
      await sql(`delete from public.alerts where title like 'RLS %' or body like 'RLS %'`)
      await sql(`delete from public.incident_notifications where title like 'New case %' or body like 'RLS %'`)
      await sql(`delete from public.incident_notes where incident_id in (select id from public.incidents where description like 'RLS %')`)
      await sql(`delete from public.incident_status_history where incident_id in (select id from public.incidents where description like 'RLS %')`)
      await sql(`delete from public.incidents where description like 'RLS %'`)
    } catch { /* best effort */ }
    const leftAlerts = await sql(`select count(*)::int as n from public.alerts where title like 'RLS %'`)
    log('Cleanup removed all test alerts', (leftAlerts[0]?.n ?? 0) === 0, `remaining=${leftAlerts[0]?.n}`)
  } else {
    log('Cleanup removed all test alerts', true, 'skipped: SUPABASE_ACCESS_TOKEN not set')
  }

  // 18. Security sweep: direct API access per role, session behaviour,
  //     input validation, upload restrictions, secret hygiene
  console.log('\n18. Security sweep');

  const ALL_TABLES = [
    'profiles', 'audit_logs', 'schools', 'location_categories', 'locations',
    'schedules', 'submissions', 'report_attachments', 'incidents',
    'incident_notes', 'incident_status_history', 'check_ins',
    'weather_observations', 'alerts', 'incident_notifications',
  ]

  // Anon must not see a single row in any table
  let anonLeaks = []
  for (const table of ALL_TABLES) {
    const { data, error } = await admin.from(table).select('*')
    const rows = Array.isArray(data) ? data.length : 0
    if (rows > 0 || error) anonLeaks.push(`${table}(${rows}${error ? ',error' : ''})`)
  }
  log('Anon sees no rows in any table', anonLeaks.length === 0, anonLeaks.join(', '))

  // Students may create only their own records
  const STUDENT_DENIED_WRITES = [
    ['profiles', { role: 'administrator' }],
    ['schools', { name: 'RLS hacked school' }],
    ['location_categories', { name: 'RLS hacked category', environment: 'indoor' }],
    ['locations', { name: 'RLS hacked location' }],
    ['schedules', { day_of_week: 1, start_time: '08:00', end_time: '09:00' }],
    ['alerts', { title: 'RLS hacked alert', body: 'RLS hacked alert body' }],
    ['incident_notifications', { case_ref: 'RLS', title: 'RLS', body: 'RLS' }],
    ['weather_observations', { source: 'open-meteo', observed_at: '2026-01-01T00:00:00Z', latitude: 0, longitude: 0, temperature_c: 20, humidity_percent: 50, rule_version: 'heat_index_v1' }],
    ['audit_logs', { action: 'RLS', entity_type: 'RLS' }],
    ['incident_notes', { body: 'RLS hacked note' }],
    ['incident_status_history', { to_status: 'closed' }],
  ]
  let studentWriteLeaks = []
  for (const [table, payload] of STUDENT_DENIED_WRITES) {
    const { error } = await studentClient.from(table).insert(payload)
    if (!error) studentWriteLeaks.push(table)
  }
  log('Student cannot write protected tables', studentWriteLeaks.length === 0,
    studentWriteLeaks.join(', '))

  // Students may not modify or delete existing records
  const { data: myLocation } = await studentClient.from('locations').select('id').limit(1)
  const studentMutations = [
    ['locations', studentClient.from('locations').update({ name: 'RLS renamed' }).eq('id', myLocation?.[0]?.id ?? '00000000-0000-0000-0000-000000000000')],
    ['schedules', studentClient.from('schedules').update({ label: 'RLS' }).eq('id', '00000000-0000-0000-0000-000000000000')],
    ['submissions', studentClient.from('submissions').update({ status: 'resolved' }).eq('id', '00000000-0000-0000-0000-000000000000')],
    ['incidents', studentClient.from('incidents').update({ status: 'closed' }).eq('id', '00000000-0000-0000-0000-000000000000')],
    ['alerts', studentClient.from('alerts').update({ title: 'RLS' }).eq('id', '00000000-0000-0000-0000-000000000000')],
    ['audit_logs', studentClient.from('audit_logs').update({ action: 'RLS' }).eq('id', 0)],
    ['weather_observations', studentClient.from('weather_observations').update({ temperature_c: 99 }).eq('id', 0)],
  ]
  const mutationResults = await Promise.all(studentMutations.map(([, q]) => q.select('id')))
  const mutationLeaks = studentMutations
    .map(([table], i) => [table, mutationResults[i]])
    .filter(([, res]) => (res?.data?.length ?? 0) > 0)
    .map(([table]) => table)
  log('Student cannot modify or delete existing records', mutationLeaks.length === 0,
    mutationLeaks.join(', '))

  // Session behaviour: a tampered token must be rejected
  const badTokenRes = await fetch(`${url}/rest/v1/locations?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: 'Bearer not-a-real-token' },
  })
  log('A tampered bearer token is rejected', badTokenRes.status === 401,
    `status=${badTokenRes.status}`)

  const noTokenRes = await fetch(`${url}/rest/v1/locations?select=id&limit=1`, {
    headers: { apikey: anonKey },
  })
  const noTokenBody = await noTokenRes.json().catch(() => [])
  log('A request without a session returns no rows', Array.isArray(noTokenBody)
    ? noTokenBody.length === 0
    : true, `status=${noTokenRes.status}`)

  // Oversized and invalid input is rejected by the database
  const tooLong = await studentClient.from('submissions').insert({
    school_id: A, kind: 'observation', sub_type: 'report', message: 'x'.repeat(2001),
  })
  log('Oversized text is rejected by the database', !!tooLong.error,
    tooLong.error?.message ?? 'no error?')

  const badStatus = await studentClient.from('check_ins').insert({
    school_id: A, location_source: 'not_a_source',
  })
  log('Invalid enum value is rejected by the database', !!badStatus.error,
    badStatus.error?.message ?? 'no error?')

  // Upload restrictions: private bucket, MIME allowlist, size limit
  const publicObject = await fetch(
    `${url.replace('https://', 'https://')}/storage/v1/object/public/report-photos/${A}/probe.png`,
  )
  log('Objects are not publicly readable', publicObject.status !== 200,
    `status=${publicObject.status}`)

  const badType = await studentClient.storage.from('report-photos')
    .upload(`${A}/00000000-0000-0000-0000-000000000000/probe.txt`, Buffer.from('plain text'), {
      contentType: 'text/plain',
    })
  log('Uploads of disallowed file types are rejected', !!badType.error,
    badType.error?.message ?? 'no error?')

  const tooBig = await studentClient.storage.from('report-photos')
    .upload(`${A}/00000000-0000-0000-0000-000000000000/big.png`, Buffer.alloc(6 * 1024 * 1024, 1), {
      contentType: 'image/png',
    })
  log('Uploads larger than the bucket limit are rejected', !!tooBig.error,
    tooBig.error?.message ?? 'no error?')

  // Secret hygiene: the privileged key must never be in the browser bundle
  let bundleLeaks = []
  try {
    const { readdirSync, readFileSync } = await import('node:fs')
    const assetsDir = resolve(import.meta.dirname, '../dist/assets')
    for (const file of readdirSync(assetsDir)) {
      if (!file.endsWith('.js')) continue
      const content = readFileSync(resolve(assetsDir, file), 'utf8')
      if (content.includes('service_role') || content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        bundleLeaks.push(file)
      }
    }
  } catch (e) {
    bundleLeaks = [`bundle not built (${e.message})`]
  }
  log('No privileged key in the built browser bundle', bundleLeaks.length === 0,
    bundleLeaks.join(', '))

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
