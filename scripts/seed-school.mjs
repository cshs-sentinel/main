/**
 * SENTINEL school seed (Phase 9).
 *
 * Creates a small SYNTHETIC school in the target Supabase project so the app
 * is explorable and the pilot has a starting point:
 *
 *   - one campus, two buildings, three floors, six rooms
 *   - a week of timetable (two periods per room per weekday)
 *   - a few check-ins, hazard reports and one open case
 *   - one published alert
 *
 * Everything is synthetic. No real person, place or event is used.
 *
 * Run: node scripts/seed-school.mjs
 * Uses the .env publishable keys and signs in as the administrator account.
 */

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
const ADMIN_EMAIL = process.env.SENTINEL_ADMIN_EMAIL ?? 'rls-admin@test.local'
const ADMIN_PASSWORD = process.env.SENTINEL_ADMIN_PASSWORD ?? 'RlsTestPass123!'
const STUDENT_EMAIL = process.env.SENTINEL_STUDENT_EMAIL ?? 'rls-student@test.local'
const STUDENT_PASSWORD = process.env.SENTINEL_STUDENT_PASSWORD ?? 'RlsTestPass123!'

const admin = createClient(url, anonKey)
const student = createClient(url, anonKey)
await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
await student.auth.signInWithPassword({ email: STUDENT_EMAIL, password: STUDENT_PASSWORD })

const { data: profile } = await admin.from('profiles').select('school_id').limit(1).single()
const schoolId = profile?.school_id
if (!schoolId) {
  console.error('Could not determine the school id from the administrator profile.')
  process.exit(1)
}
console.log(`seeding school ${schoolId}\n`)

const { data: categories } = await admin
  .from('location_categories')
  .select('id, name, environment')
const cat = (name) => categories?.find((c) => c.name === name)?.id

// ------------------------------------------------------------------ locations
const { data: existing } = await admin
  .from('locations')
  .select('id, name')
  .eq('status', 'active')
  .in('name', ['Demo Campus', 'Demo North Wing', 'Demo South Wing'])

if (existing && existing.length > 0) {
  console.log('Demo locations already exist - skipping location creation.')
} else {
  const mk = async (fields) => {
    const { data, error } = await admin
      .from('locations')
      .insert({ school_id: schoolId, ...fields })
      .select('id, name')
      .single()
    if (error) throw new Error(`${fields.name}: ${error.message}`)
    console.log(`  location: ${fields.name}`)
    return data
  }

  const campus = await mk({
    name: 'Demo Campus',
    category_id: cat('Open Space'),
    environment: 'outdoor',
  })
  const north = await mk({
    name: 'Demo North Wing',
    parent_id: campus.id,
    category_id: cat('Building'),
    environment: 'indoor',
  })
  const south = await mk({
    name: 'Demo South Wing',
    parent_id: campus.id,
    category_id: cat('Building'),
    environment: 'indoor',
  })
  const northGround = await mk({
    name: 'Demo North Ground Floor',
    parent_id: north.id,
    category_id: cat('Floor'),
    environment: 'indoor',
  })
  const northFirst = await mk({
    name: 'Demo North First Floor',
    parent_id: north.id,
    category_id: cat('Floor'),
    environment: 'indoor',
  })
  const southGround = await mk({
    name: 'Demo South Ground Floor',
    parent_id: south.id,
    category_id: cat('Floor'),
    environment: 'indoor',
  })

  const rooms = [
    ['Demo Room 101', northGround.id],
    ['Demo Room 102', northGround.id],
    ['Demo Room 201', northFirst.id],
    ['Demo Science Lab', northFirst.id],
    ['Demo Library', southGround.id],
    ['Demo Gymnasium', southGround.id],
  ]
  for (const [name, parentId] of rooms) {
    await mk({
      name,
      parent_id: parentId,
      category_id: cat('Room'),
      environment: 'indoor',
      code: name.replace('Demo ', '').replace(/\s+/g, ''),
    })
  }
}

// ------------------------------------------------------------------ schedules
const { data: rooms } = await admin
  .from('locations')
  .select('id, name')
  .eq('status', 'active')
  .like('name', 'Demo Room%')
  .like('name', 'Demo %')
  .limit(6)

const { count: scheduleCount } = await admin
  .from('schedules')
  .select('id', { count: 'exact', head: true })

if ((scheduleCount ?? 0) > 0) {
  console.log(`\n${scheduleCount} schedules already exist - skipping timetable creation.`)
} else {
  let created = 0
  for (const room of rooms ?? []) {
    for (let day = 1; day <= 5; day += 1) {
      for (const [start, end, label] of [
        ['08:00', '09:00', 'Period 1'],
        ['09:00', '10:00', 'Period 2'],
      ]) {
        const { error } = await admin.from('schedules').insert({
          school_id: schoolId,
          location_id: room.id,
          day_of_week: day,
          start_time: start,
          end_time: end,
          effective_from: '2026-01-05',
          label: `${label} - ${room.name}`,
          status: 'active',
        })
        if (error) {
          console.error(`  schedule error (${room.name} ${day} ${start}): ${error.message}`)
        } else {
          created += 1
        }
      }
    }
  }
  console.log(`\ncreated ${created} timetable slots.`)
}

// ------------------------------------------------- check-ins, reports, cases
const { count: checkInCount } = await admin
  .from('check_ins')
  .select('id', { count: 'exact', head: true })
if ((checkInCount ?? 0) === 0) {
  for (const period of ['Period 1', 'Period 2']) {
    await student.from('check_ins').insert({
      school_id: schoolId,
      location_source: 'self_selected',
      period,
      status: 'safe',
    })
  }
  console.log('created 2 sample check-ins.')
}

const { count: reportCount } = await admin
  .from('submissions')
  .select('id', { count: 'exact', head: true })
if ((reportCount ?? 0) === 0) {
  await student.from('submissions').insert({
    school_id: schoolId,
    kind: 'observation',
    sub_type: 'safety_concern',
    message: 'Sample submission: the gym door handle is loose.',
  })
  await admin.from('submissions').insert({
    school_id: schoolId,
    kind: 'incident_hazard',
    sub_type: 'unsafe_condition',
    message: 'Sample submission: the corridor outside the hall is congested at break.',
  })
  await student.from('submissions').insert({
    school_id: schoolId,
    kind: 'sentiment',
    sub_type: 'stressed',
    emotion: 'stressed',
    stress_level: 4,
    message: 'Sample submission: exam week is piling up and I am finding it hard to sleep.',
  })
  console.log('created 3 sample submissions.')
}

const { count: incidentCount } = await admin
  .from('incidents')
  .select('id', { count: 'exact', head: true })
if ((incidentCount ?? 0) === 0) {
  const { data: incident } = await student
    .from('incidents')
    .insert({
      school_id: schoolId,
      category: 'medical',
      description: 'Sample case: a student felt unwell near the library; first aid called.',
    })
    .select('id, case_ref')
    .single()
  if (incident?.id) {
    await admin.rpc('transition_incident', {
      incident_id: incident.id,
      new_status: 'acknowledged',
      note: null,
    })
  }
  console.log('created 1 sample case (acknowledged).')
}

const { count: alertCount } = await admin
  .from('alerts')
  .select('id', { count: 'exact', head: true })
if ((alertCount ?? 0) === 0) {
  const { data: alert } = await admin
    .from('alerts')
    .insert({
      school_id: schoolId,
      title: 'Sample alert: drill on Friday at 10:00',
      body: 'There will be an evacuation drill on Friday at 10:00. Please follow the instructions of your teacher and the drill marshals.',
      severity: 'advisory',
      target_scope: 'all',
    })
    .select('id')
    .single()
  if (alert?.id) {
    await admin.rpc('approve_alert', { alert_id: alert.id })
    await admin.rpc('publish_alert', { alert_id: alert.id })
  }
  console.log('created 1 published sample alert.')
}

console.log('\nSeed complete. Open the app to explore the demo school.')
