export const ALERT_SEVERITIES = [
  { value: 'info', label: 'Information' },
  { value: 'advisory', label: 'Advisory' },
  { value: 'urgent', label: 'Urgent' },
] as const

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]['value']

export const ALERT_STATUSES = [
  'draft',
  'approved',
  'published',
  'corrected',
  'cancelled',
] as const

export type AlertStatus = (typeof ALERT_STATUSES)[number]

export const ALERT_SCOPES = [
  { value: 'all', label: 'Everyone in the school' },
  { value: 'role', label: 'One role' },
  { value: 'responders', label: 'Responders and administrators' },
] as const

export const ALERT_SELECT =
  'id, title, body, severity, status, target_scope, target_role, created_by, approved_at, published_at, cancelled_at, cancel_reason, supersedes_id, version, created_at, incident_id'

export interface AlertRow {
  id: string
  title: string
  body: string
  severity: string
  status: string
  target_scope: string
  target_role: string | null
  created_by: string
  approved_at: string | null
  published_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  supersedes_id: string | null
  version: number
  created_at: string
  incident_id: string | null
}

export interface CaseNotificationRow {
  id: string
  case_ref: string
  title: string
  body: string
  created_at: string
}

export function severityLabel(value: string): string {
  return ALERT_SEVERITIES.find((severity) => severity.value === value)?.label ?? value
}

export function statusLabel(value: string): string {
  switch (value) {
    case 'approved':
      return 'Approved'
    case 'published':
      return 'Published'
    case 'corrected':
      return 'Corrected'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Draft'
  }
}

export function scopeLabel(alert: AlertRow): string {
  if (alert.target_scope === 'responders') return 'Responders and administrators'
  if (alert.target_scope === 'role') return `Role: ${alert.target_role ?? 'unknown'}`
  return 'Everyone in the school'
}

export function formatAlertTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
