import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import {
  MAX_DESCRIPTION,
  MIN_DESCRIPTION,
  PHOTO_BUCKET,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  REPORT_CATEGORIES,
  REPORT_SELECT,
  categoryLabel,
  formatReportDate,
  photoPath,
  statusLabel,
} from './shared'
import type { AttachmentRow, LocationOption, ReportRow } from './shared'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export default function Reports() {
  const { schoolId } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [category, setCategory] = useState<string>(REPORT_CATEGORIES[0].value)
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('hazard_reports')
          .select(REPORT_SELECT)
          .order('created_at', { ascending: false }),
        supabase.from('report_attachments').select('report_id, storage_path'),
        supabase
          .from('locations')
          .select('id, name')
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (
      reportResult: QueryResult,
      attachmentResult: QueryResult,
      locationResult: QueryResult,
    ) => {
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
      if (locationResult.error) {
        setError(locationResult.error.message)
      } else {
        setLocations((locationResult.data ?? []) as LocationOption[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then(([reportResult, attachmentResult, locationResult]) => {
      if (cancelled) return
      applyResults(reportResult, attachmentResult, locationResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [reportResult, attachmentResult, locationResult] = await fetchResults()
    applyResults(reportResult, attachmentResult, locationResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  const attachmentByReport = useMemo(() => {
    const map = new Map<string, string>()
    for (const attachment of attachments) {
      if (!map.has(attachment.report_id)) map.set(attachment.report_id, attachment.storage_path)
    }
    return map
  }, [attachments])

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setFormError('')
    if (!file) {
      setPhoto(null)
      return
    }
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhoto(null)
      setFormError('Photo must be a JPEG, PNG or WebP image')
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhoto(null)
      setFormError('Photo must be 5 MB or smaller')
      return
    }
    setPhoto(file)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!schoolId) {
      setFormError('No school is assigned to this account.')
      return
    }
    const trimmed = description.trim()
    if (trimmed.length < MIN_DESCRIPTION) {
      setFormError(`Description must be at least ${MIN_DESCRIPTION} characters`)
      return
    }
    if (trimmed.length > MAX_DESCRIPTION) {
      setFormError(`Description must be at most ${MAX_DESCRIPTION} characters`)
      return
    }
    setFormError('')
    setNotice('')
    setSubmitting(true)
    try {
      const { data, error: insertError } = await supabase
        .from('hazard_reports')
        .insert({
          school_id: schoolId,
          category,
          description: trimmed,
          location_id: locationId || null,
        })
        .select('id')
        .single()
      if (insertError) {
        setFormError(insertError.message)
        return
      }
      const reportId = (data as { id?: string } | null)?.id
      if (photo && reportId) {
        const path = photoPath(schoolId, reportId, photo.name)
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photo, { contentType: photo.type })
        if (uploadError) {
          setNotice(
            `Report filed, but the photo could not be uploaded: ${uploadError.message}`,
          )
        } else {
          const { error: attachmentError } = await supabase
            .from('report_attachments')
            .insert({ report_id: reportId, school_id: schoolId, storage_path: path })
          if (attachmentError) {
            setNotice(`Report filed, but the photo link failed: ${attachmentError.message}`)
          }
        }
      }
      setDescription('')
      setLocationId('')
      setPhoto(null)
      setNotice((previous) => previous || 'Report filed. A responder will review it.')
      await load()
    } finally {
      setSubmitting(false)
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
      <h1>Hazard reports</h1>
      <p className="admin-subtitle">
        Report a facility or safety problem. Reports go to responders and
        administrators for review. Only you and reviewers can see a report you file.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <form className="rep-form" aria-label="New hazard report" onSubmit={(e) => void handleSubmit(e)}>
        <h2>Report a hazard</h2>
        {formError && (
          <p role="alert" className="auth-error">
            {formError}
          </p>
        )}
        {notice && (
          <p role="status" className="rep-notice">
            {notice}
          </p>
        )}

        <label htmlFor="rep-category">Category</label>
        <select
          id="rep-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {REPORT_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label htmlFor="rep-description">Description</label>
        <textarea
          id="rep-description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What did you see, and where?"
        />

        <label htmlFor="rep-location">Location (optional)</label>
        <select
          id="rep-location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">No specific location</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>

        <label htmlFor="rep-photo">Photo (optional)</label>
        <input id="rep-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} />

        <div className="loc-form-actions">
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Filing…' : 'File report'}
          </button>
        </div>
      </form>

      {loading ? (
        <p role="status">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="loc-empty">You have not filed any reports yet.</p>
      ) : (
        <ul className="loc-list">
          {reports.map((report) => (
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
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
