/** Formats an ISO timestamp for display. Returns the raw value if unparseable. */
export function formatReportDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString()
}
