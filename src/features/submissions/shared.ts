export const SUBMISSION_KINDS = [
  { value: 'sentiment', label: 'Sentiment & Feelings', hint: 'How you are feeling, or something weighing on you' },
  { value: 'incident_hazard', label: 'Incidents & Hazards', hint: 'Bullying, unsafe conditions, suspicious activity' },
  { value: 'emergency', label: 'Emergencies', hint: 'Fire, injury, accident, immediate threat' },
  { value: 'observation', label: 'Other Observations', hint: 'Suggestions, reports, safety concerns' },
] as const

export type SubmissionKind = (typeof SUBMISSION_KINDS)[number]['value']

export const SUBMISSION_SUB_TYPES: Record<string, { value: string; label: string }[]> = {
  sentiment: [
    { value: 'joy', label: 'Joyful' },
    { value: 'calm', label: 'Calm' },
    { value: 'worried', label: 'Worried' },
    { value: 'sad', label: 'Sad' },
    { value: 'angry', label: 'Angry' },
    { value: 'stressed', label: 'Stressed' },
    { value: 'hopeless', label: 'Hopeless' },
    { value: 'lonely', label: 'Lonely' },
  ],
  incident_hazard: [
    { value: 'bullying', label: 'Bullying' },
    { value: 'unsafe_condition', label: 'Unsafe condition' },
    { value: 'suspicious_activity', label: 'Suspicious activity' },
  ],
  observation: [
    { value: 'suggestion', label: 'Suggestion' },
    { value: 'report', label: 'Report' },
    { value: 'safety_concern', label: 'Safety concern' },
  ],
}

export const SUBMISSION_STATUSES = ['new', 'acknowledged', 'resolved'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export const SUBMISSION_SELECT =
  'id, kind, sub_type, message, location_id, emotion, stress_level, status, submitted_by, acknowledged_at, resolved_at, resolution_note, created_at'

export interface SubmissionRow {
  id: string
  kind: string
  sub_type: string
  message: string
  location_id: string | null
  emotion: string | null
  stress_level: number | null
  status: string
  submitted_by: string
  acknowledged_at: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
}

export type { LocationOption } from '../locations/shared'

export function kindLabel(value: string): string {
  return SUBMISSION_KINDS.find((kind) => kind.value === value)?.label ?? value
}

export function subTypeLabel(kind: string, subType: string): string {
  return (
    SUBMISSION_SUB_TYPES[kind]?.find((option) => option.value === subType)?.label ?? subType
  )
}

export function statusLabel(value: string): string {
  switch (value) {
    case 'acknowledged':
      return 'Acknowledged'
    case 'resolved':
      return 'Resolved'
    default:
      return 'New'
  }
}

export function stressLabel(level: number | null): string {
  if (level === null) return ''
  const labels = ['', 'Very low', 'Low', 'Moderate', 'High', 'Very high']
  return labels[level] ?? String(level)
}

export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
