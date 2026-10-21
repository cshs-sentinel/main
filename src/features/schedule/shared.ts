export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const SCHEDULE_SELECT =
  'id, location_id, day_of_week, start_time, end_time, effective_from, effective_until, label, status, locations(name)'

export interface ScheduleRow {
  id: string
  location_id: string
  day_of_week: number
  start_time: string
  end_time: string
  effective_from: string
  effective_until: string | null
  label: string | null
  status: string
  locations: { name: string } | null
}

export function formatTime(value: string): string {
  return value.slice(0, 5)
}

export function formatTimeRange(row: ScheduleRow): string {
  return `${formatTime(row.start_time)}–${formatTime(row.end_time)}`
}

export function formatEffective(row: ScheduleRow): string {
  if (!row.effective_until) return `from ${row.effective_from}, open-ended`
  return `${row.effective_from} – ${row.effective_until}`
}

export function daySortKey(day: number): number {
  return (day + 6) % 7
}

export function compareSchedules(a: ScheduleRow, b: ScheduleRow): number {
  const dayDiff = daySortKey(a.day_of_week) - daySortKey(b.day_of_week)
  if (dayDiff !== 0) return dayDiff
  return a.start_time.localeCompare(b.start_time)
}

export function todayLocal(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
