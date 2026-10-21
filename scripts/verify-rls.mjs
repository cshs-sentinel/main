// RLS verification for SENTINEL identity, locations, schedules, and multi-school migrations.
// Uses existing test users created in the dashboard.
// Run: node scripts/verify-rls.mjs
// Set SUPABASE_ACCESS_TOKEN to include multi-school (section 9) checks.

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
    'RLS Schedule Room']

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
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = new URL(url).hostname.split('.')[0]
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
