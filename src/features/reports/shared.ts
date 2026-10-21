export const REPORT_CATEGORIES = [
  { value: 'facility_damage', label: 'Facility damage' },
  { value: 'safety_hazard', label: 'Safety hazard' },
  { value: 'crowding', label: 'Crowding / overcrowding' },
  { value: 'other', label: 'Other' },
] as const

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value']

export const REPORT_STATUSES = ['open', 'acknowledged', 'resolved'] as const

export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REPORT_SELECT =
  'id, category, description, status, location_id, created_at, locations(name)'

export const MIN_DESCRIPTION = 3
export const MAX_DESCRIPTION = 2000

export const PHOTO_BUCKET = 'report-photos'
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface ReportRow {
  id: string
  category: string
  description: string
  status: string
  location_id: string | null
  created_at: string
  locations?: { name: string } | null
}

export interface AttachmentRow {
  report_id: string
  storage_path: string
}

export interface LocationOption {
  id: string
  name: string
}

export function categoryLabel(value: string): string {
  return REPORT_CATEGORIES.find((category) => category.value === value)?.label ?? value
}

export function statusLabel(value: string): string {
  switch (value) {
    case 'acknowledged':
      return 'Acknowledged'
    case 'resolved':
      return 'Resolved'
    default:
      return 'Open'
  }
}

export function formatReportDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned || 'photo'
}

export function photoPath(schoolId: string, reportId: string, fileName: string): string {
  return `${schoolId}/${reportId}/${safeFileName(fileName)}`
}
