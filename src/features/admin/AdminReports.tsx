import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  PHOTO_BUCKET,
  REPORT_SELECT,
  REPORT_STATUSES,
  categoryLabel,
  formatReportDate,
  statusLabel,
} from '../reports/shared'
import type { AttachmentRow, ReportRow, ReportStatus } from '../reports/shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

type Filter = 'all' | ReportStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
]

export default function AdminReports() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('hazard_reports')
          .select(REPORT_SELECT)
          .order('created_at', { ascending: false }),
        supabase.from('report_attachments').select('report_id, storage_path'),
      ]),
    [],
  )

  const applyResults = useCallback(
    (reportResult: QueryResult, attachmentResult: QueryResult) => {
      if (reportResult.error) {
        setError(reportResult.error.message)
      } else {
        setReports((reportResult.data ?? []) as ReportRow[])
      }
      if (attachmentResult.error) {
        setError(attachmentResult.error.message)
      } else {
        setAttachments((attachmentResult.data ?? []) as AttachmentRow[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then(([reportResult, attachmentResult]) => {
      if (cancelled) return
      applyResults(reportResult, attachmentResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [reportResult, attachmentResult] = await fetchResults()
    applyResults(reportResult, attachmentResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  const attachmentByReport = useMemo(() => {
    const map = new Map<string, string>()
    for (const attachment of attachments) {
      if (!map.has(attachment.report_id)) map.set(attachment.report_id, attachment.storage_path)
    }
    return map
  }, [attachments])

  const visible = useMemo(
    () => (filter === 'all' ? reports : reports.filter((report) => report.status === filter)),
    [reports, filter],
  )

  async function changeStatus(report: ReportRow, status: ReportStatus) {
    setError('')
    setBusyId(report.id)
    try {
      const { error: updateError } = await supabase
        .from('hazard_reports')
        .update({ status })
        .eq('id', report.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      await load()
    } finally {
      setBusyId('')
    }
  }

  async function viewPhoto(reportId: string) {
    const path = attachmentByReport.get(reportId)
    if (!path) return
    setError('')
    const { data, error: signedError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, 60)
    if (signedError) {
      setError(signedError.message)
      return
    }
    const url = (data as { signedUrl?: string } | null)?.signedUrl
    if (url) {
      setPhotoUrls((previous) => ({ ...previous, [reportId]: url }))
    }
  }

  return (
    <main id="main" className="admin-page">
      <h1>Hazard report review</h1>
      <p className="admin-subtitle">
        Reports filed in your school. Acknowledge a report to show it has been seen,
        then resolve it once the issue is handled.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="loc-toolbar" role="group" aria-label="Filter reports by status">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === filter ? 'btn' : 'btn btn-secondary'}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status">Loading reports…</p>
      ) : visible.length === 0 ? (
        <p className="loc-empty">No reports in this view.</p>
      ) : (
        <ul className="loc-list">
          {visible.map((report) => (
            <li key={report.id} className="loc-row">
              <div className="loc-head">
                <span className="loc-name">{categoryLabel(report.category)}</span>
                <span className={`rep-status rep-status-${report.status}`}>
                  {statusLabel(report.status)}
                </span>
              </div>
              <span className="loc-meta">
                {report.locations?.name ?? 'No specific location'} ·{' '}
                {formatReportDate(report.created_at)}
              </span>
              <p className="rep-description">{report.description}</p>

              {attachmentByReport.has(report.id) && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void viewPhoto(report.id)}
                  >
                    View photo
                  </button>
                  {photoUrls[report.id] && (
                    <a
                      className="rep-photo-link"
                      href={photoUrls[report.id]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open photo (link expires in 60 seconds)
                    </a>
                  )}
                </>
              )}

              <div className="loc-actions">
                {report.status === 'open' && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === report.id}
                    onClick={() => void changeStatus(report, 'acknowledged')}
                  >
                    Acknowledge
                  </button>
                )}
                {report.status === 'acknowledged' && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === report.id}
                      onClick={() => void changeStatus(report, 'resolved')}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyId === report.id}
                      onClick={() => void changeStatus(report, 'open')}
                    >
                      Reopen
                    </button>
                  </>
                )}
                {report.status === 'resolved' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === report.id}
                    onClick={() => void changeStatus(report, 'acknowledged')}
                  >
                    Reopen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="loc-meta">
        Statuses follow the server workflow: {REPORT_STATUSES.join(' → ')}.
      </p>
    </main>
  )
}
