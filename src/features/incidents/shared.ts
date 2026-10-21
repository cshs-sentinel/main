export const INCIDENT_CATEGORIES = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'medical', label: 'Medical' },
  { value: 'security', label: 'Security' },
  { value: 'other', label: 'Other' },
] as const

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]['value']

export const INCIDENT_STATUSES = [
  'new',
  'acknowledged',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
] as const

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const INCIDENT_SELECT =
  'id, case_ref, status, category, description, location_id, created_at, acknowledged_at, assigned_at, resolved_at, closed_at, cancelled_at, cancelled_reason, resolution_notes, locations(name)'

export const MIN_DESCRIPTION = 3
export const MAX_DESCRIPTION = 2000

export interface IncidentRow {
  id: string
  case_ref: string
  status: string
  category: string
  description: string
  location_id: string | null
  created_at: string
  acknowledged_at: string | null
  assigned_at: string | null
  resolved_at: string | null
  closed_at: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  resolution_notes: string | null
  locations?: { name: string } | null
}

export interface HistoryRow {
  id: number
  incident_id: string
  from_status: string | null
  to_status: string
  actor_id: string | null
  note: string | null
  created_at: string
}

export interface NoteRow {
  id: number
  incident_id: string
  author_id: string
  body: string
  created_at: string
}

export function categoryLabel(value: string): string {
  return INCIDENT_CATEGORIES.find((category) => category.value === value)?.label ?? value
}

export function statusLabel(value: string): string {
  switch (value) {
    case 'acknowledged':
      return 'Acknowledged'
    case 'assigned':
      return 'Assigned'
    case 'in_progress':
      return 'In progress'
    case 'resolved':
      return 'Resolved'
    case 'closed':
      return 'Closed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'New'
  }
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function isOpen(status: string): boolean {
  return ['new', 'acknowledged', 'assigned', 'in_progress'].includes(status)
}
