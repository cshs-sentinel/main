/**
 * SENTINEL end-to-end journey test (Phase 9, Task 9.4).
 *
 * Drives the real product journeys through the live Supabase API with real
 * signed-in sessions, exactly as the browser would:
 *
 *   student: check in -> file a hazard report (with a photo) -> raise an SOS
 *   admin:   acknowledge -> assign -> resolve -> close, and draft -> approve ->
 *            publish an alert
 *   checks:  the forbidden paths are refused, the dashboard counts match the
 *            underlying rows, and the history is retained
 *
 * It is not a browser test (that is still open, risk M1) but it proves the
 * server-side behaviour of every journey end to end against the real database.
 *
 * Run: node scripts/journey.mjs        (needs the .env with the publishable keys)
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

const results = []
let failed = 0

function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  if (!pass) failed += 1
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function withRetry(fn, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastError
}

async function signIn(email, password) {
  const client = createClient(url, anonKey)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return client
}

const schoolId = '11111111-1111-1111-1111-111111111111'
const STAMP = `JRN-${Date.now()}`

console.log('SENTINEL end-to-end journey')
console.log('============================\n')

const admin = await withRetry(() => signIn(ADMIN_EMAIL, ADMIN_PASSWORD))
const student = await withRetry(() => signIn(STUDENT_EMAIL, STUDENT_PASSWORD))
console.log(`signed in: ${ADMIN_EMAIL}, ${STUDENT_EMAIL}\n`)

// --------------------------------------------------------------- 1. check-in
console.log('1. Safety check-in')
const checkIn = await withRetry(() =>
  student.from('check_ins').insert({
    school_id: schoolId,
    location_source: 'self_selected',
    period: `${STAMP} Period 1`,
    status: 'safe',
  }).select('id, status').single(),
)
check('student records a check-in', !checkIn.error && !!checkIn.data?.id, checkIn.error?.message ?? '')

const fakeSource = await withRetry(() =>
  student.from('check_ins').insert({
    school_id: schoolId,
    location_source: 'staff_verified',
  }),
)
check(
  'student cannot claim a staff-verified location',
  !!fakeSource.error && /responders or administrators/i.test(fakeSource.error.message),
  fakeSource.error?.message ?? 'no error?',
)

// ------------------------------------------------------------ 2. hazard report
console.log('\n2. Hazard report with a photo')
const { data: locations } = await withRetry(() =>
  student.from('locations').select('id, name').eq('status', 'active').limit(1),
)
const location = locations?.[0]

const report = await withRetry(() =>
  student.from('hazard_reports').insert({
    school_id: schoolId,
    category: 'safety_hazard',
    description: `${STAMP} journey report: loose handrail on the north stair`,
    location_id: location?.id ?? null,
  }).select('id, status').single(),
)
check('student files a hazard report', !report.error && !!report.data?.id, report.error?.message ?? '')

let photoPath = ''
if (report.data?.id) {
  photoPath = `${schoolId}/${report.data.id}/journey.png`
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const upload = await withRetry(() =>
    student.storage.from('report-photos').upload(photoPath, png, { contentType: 'image/png' }),
  )
  check('reporter uploads a photo to the private bucket', !upload.error, upload.error?.message ?? '')

  const attachment = await withRetry(() =>
    student.from('report_attachments').insert({
      report_id: report.data.id,
      school_id: schoolId,
      storage_path: photoPath,
    }),
  )
  check('reporter registers the attachment', !attachment.error, attachment.error?.message ?? '')

  const signed = await withRetry(() =>
    student.storage.from('report-photos').createSignedUrl(photoPath, 60),
  )
  check('reporter can read their own photo', !!signed.data?.signedUrl, signed.error?.message ?? '')

  // An anonymous visitor must not be able to obtain a link to the photo
  const anonClient = createClient(url, anonKey)
  const anonSigned = await withRetry(() =>
    anonClient.storage.from('report-photos').createSignedUrl(photoPath, 60),
  )
  check(
    'an anonymous visitor cannot obtain the photo',
    !anonSigned.data?.signedUrl,
    anonSigned.error?.message ?? 'a link was issued',
  )

  // A reviewer (administrator) legitimately may read school report photos
  const reviewerSigned = await withRetry(() =>
    admin.storage.from('report-photos').createSignedUrl(photoPath, 60),
  )
  check(
    'a reviewer can read a school report photo',
    !!reviewerSigned.data?.signedUrl,
    reviewerSigned.error?.message ?? 'no link',
  )
}

// -------------------------------------------------------------- 3. SOS journey
console.log('\n3. SOS journey')
const incident = await withRetry(() =>
  student.from('incidents').insert({
    school_id: schoolId,
    category: 'emergency',
    description: `${STAMP} journey incident: smoke reported on the second floor`,
    location_id: location?.id ?? null,
  }).select('id, case_ref, status').single(),
)
check('student raises an SOS', !incident.error && !!incident.data?.id, incident.error?.message ?? '')
check(
  'case reference is SNT-YYYY-####',
  /^SNT-\d{4}-\d{4}$/.test(incident.data?.case_ref ?? ''),
  `case_ref=${incident.data?.case_ref ?? 'missing'}`,
)

const duplicate = await withRetry(() =>
  student.from('incidents').insert({
    school_id: schoolId,
    category: 'emergency',
    description: `${STAMP} duplicate incident attempt`,
  }),
)
check(
  'duplicate SOS within the cooldown is rejected',
  !!duplicate.error && /already have an open incident/i.test(duplicate.error.message),
  duplicate.error?.message ?? 'no error?',
)

const studentPublish = await withRetry(() =>
  student.rpc('transition_incident', {
    incident_id: incident.data?.id,
    new_status: 'acknowledged',
    note: null,
  }),
)
check(
  'a student cannot acknowledge a case',
  !!studentPublish.error && /not allowed for your role/i.test(studentPublish.error.message),
  studentPublish.error?.message ?? 'no error?',
)

if (incident.data?.id) {
  for (const step of ['acknowledged', 'assigned', 'in_progress', 'resolved', 'closed']) {
    const transition = await withRetry(() =>
      admin.rpc('transition_incident', {
        incident_id: incident.data.id,
        new_status: step,
        note: step === 'resolved' ? `${STAMP} resolved on site` : null,
      }),
    )
    check(
      `responder moves the case to ${step}`,
      !transition.error,
      transition.error?.message ?? '',
    )
  }

  const { data: closed } = await withRetry(() =>
    admin.from('incidents').select('status, resolution_notes').eq('id', incident.data.id).single(),
  )
  check(
    'case ends closed with a resolution note',
    closed?.status === 'closed' && String(closed?.resolution_notes ?? '').includes(STAMP),
    `status=${closed?.status}`,
  )

  const { data: history } = await withRetry(() =>
    admin.from('incident_status_history')
      .select('from_status, to_status')
      .eq('incident_id', incident.data.id),
  )
  check('status history retains every transition', (history?.length ?? 0) === 5, `rows=${history?.length ?? 0}`)

  const note = await withRetry(() =>
    admin.from('incident_notes').insert({
      incident_id: incident.data.id,
      body: `${STAMP} responder note`,
    }),
  )
  check('responder adds a response note', !note.error, note.error?.message ?? '')

  const { data: notifications } = await withRetry(() =>
    admin.from('incident_notifications').select('id').eq('incident_id', incident.data.id),
  )
  check('the case created a reviewer notification', (notifications?.length ?? 0) === 1,
    `rows=${notifications?.length ?? 0}`)
}

// ------------------------------------------------------------ 4. alert journey
console.log('\n4. Alert journey')
const draft = await withRetry(() =>
  admin.from('alerts').insert({
    school_id: schoolId,
    title: `${STAMP} drill notice`,
    body: `${STAMP} there will be an evacuation drill at 10:00.`,
    severity: 'advisory',
    target_scope: 'all',
  }).select('id, status, version').single(),
)
check('administrator drafts an alert', !draft.error && draft.data?.status === 'draft', draft.error?.message ?? '')

if (draft.data?.id) {
  const directPublish = await withRetry(() =>
    admin.from('alerts').update({ status: 'published' }).eq('id', draft.data.id).select('id'),
  )
  const stillDraft = await withRetry(() =>
    admin.from('alerts').select('status').eq('id', draft.data.id).single(),
  )
  check(
    'a client cannot publish an alert directly',
    (directPublish.data?.length ?? 0) === 0 && stillDraft.data?.status === 'draft',
    `rows=${directPublish.data?.length ?? 0} status=${stillDraft.data?.status}`,
  )

  const approve = await withRetry(() => admin.rpc('approve_alert', { alert_id: draft.data.id }))
  check('administrator approves the alert', !approve.error, approve.error?.message ?? '')

  const publish = await withRetry(() => admin.rpc('publish_alert', { alert_id: draft.data.id }))
  check('administrator publishes the alert', !publish.error, publish.error?.message ?? '')

  const { data: visible } = await withRetry(() =>
    student.from('alerts').select('id, status').eq('id', draft.data.id),
  )
  check('the published alert reaches the student feed', (visible?.length ?? 0) === 1,
    `rows=${visible?.length ?? 0}`)

  const { data: audit } = await withRetry(() =>
    admin.from('audit_logs').select('action').eq('entity_type', 'alerts'),
  )
  const actions = new Set((audit ?? []).map((row) => row.action))
  check('the alert workflow is audited',
    actions.has('alert_approved') && actions.has('alert_published'),
    `actions=${[...actions].join(',')}`)
}

// ------------------------------------------------------------ 5. dashboard truth
console.log('\n5. Dashboard matches the records')
const countsResult = await withRetry(() => admin.rpc('dashboard_counts'))
const counts = countsResult.data
const visibleIncidents = await withRetry(() => admin.from('incidents').select('id, status'))
const openIncidents = (visibleIncidents.data ?? []).filter((row) =>
  ['new', 'acknowledged', 'assigned', 'in_progress'].includes(row.status),
)
check(
  'administrator dashboard counts the open incidents it can read',
  counts?.school_open_incidents === openIncidents.length,
  `dashboard=${counts?.school_open_incidents} open rows=${openIncidents.length} of ${visibleIncidents.data?.length ?? 0}`,
)
const visibleReports = await withRetry(() => admin.from('hazard_reports').select('id, status'))
const openReports = (visibleReports.data ?? []).filter((row) => row.status !== 'resolved')
check(
  'administrator dashboard counts the open reports it can read',
  counts?.school_open_reports === openReports.length,
  `dashboard=${counts?.school_open_reports} open rows=${openReports.length}`,
)

// --------------------------------------------------------------- 6. clean up
console.log('\n6. Cleaning up journey records')
await withRetry(() => admin.from('incident_notes').delete().eq('body', `${STAMP} responder note`))
await withRetry(() => admin.from('check_ins').delete().eq('period', `${STAMP} Period 1`))
await withRetry(() => admin.from('hazard_reports').delete().eq('description', `${STAMP} journey report: loose handrail on the north stair`))
await withRetry(() => admin.from('alerts').delete().eq('title', `${STAMP} drill notice`))
await withRetry(() => admin.from('incidents').delete().eq('description', `${STAMP} journey incident: smoke reported on the second floor`))
await withRetry(() => admin.from('alerts').delete().eq('title', `${STAMP} drill notice`))
console.log('  (rows that the RLS policies retain are left in place by design)')

console.log(`\n${results.length - failed}/${results.length} journey steps passed`)
process.exit(failed > 0 ? 1 : 0)
