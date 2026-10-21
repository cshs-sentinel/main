import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthContext'

interface LocationRow {
  id: string
  parent_id: string | null
  category_id: string
  name: string
  code: string | null
  description: string | null
  environment: string
  status: string
  access_level: string
}

interface CategoryRow {
  id: string
  name: string
  environment: string
  is_active: boolean
}

interface FormValues {
  name: string
  code: string
  category_id: string
  environment: string
  parent_id: string
  access_level: string
  description: string
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

const LOCATION_COLUMNS =
  'id, parent_id, category_id, name, code, description, environment, status, access_level'
const CATEGORY_COLUMNS = 'id, name, environment, is_active'

const ENVIRONMENTS = ['indoor', 'outdoor', 'covered']
const ACCESS_LEVELS = ['public', 'staff', 'restricted']
const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All statuses' },
]

function descendantsOf(rootId: string, rows: LocationRow[]): Set<string> {
  const out = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (row.parent_id && out.has(row.parent_id) && !out.has(row.id)) {
        out.add(row.id)
        changed = true
      }
    }
  }
  return out
}

function orderTree(rows: LocationRow[]): Array<{ row: LocationRow; depth: number }> {
  const present = new Map(rows.map((row) => [row.id, row]))
  const children = new Map<string, LocationRow[]>()
  const roots: LocationRow[] = []
  for (const row of rows) {
    if (row.parent_id && present.has(row.parent_id)) {
      const siblings = children.get(row.parent_id)
      if (siblings) siblings.push(row)
      else children.set(row.parent_id, [row])
    } else {
      roots.push(row)
    }
  }
  const byName = (a: LocationRow, b: LocationRow) => a.name.localeCompare(b.name)
  roots.sort(byName)
  for (const list of children.values()) list.sort(byName)
  const out: Array<{ row: LocationRow; depth: number }> = []
  const walk = (row: LocationRow, depth: number) => {
    out.push({ row, depth })
    for (const child of children.get(row.id) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return out
}

function LocationForm({
  categories,
  locations,
  initial,
  onSubmit,
  onCancel,
}: {
  categories: CategoryRow[]
  locations: LocationRow[]
  initial: LocationRow | null
  onSubmit: (values: FormValues) => Promise<string | null>
  onCancel: () => void
}) {
  const [values, setValues] = useState<FormValues>(() => ({
    name: initial?.name ?? '',
    code: initial?.code ?? '',
    category_id: initial?.category_id ?? '',
    environment: initial?.environment ?? 'indoor',
    parent_id: initial?.parent_id ?? '',
    access_level: initial?.access_level ?? 'staff',
    description: initial?.description ?? '',
  }))
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const excludedParents = useMemo(
    () => (initial ? descendantsOf(initial.id, locations) : new Set<string>()),
    [initial, locations],
  )
  const parentOptions = locations.filter(
    (row) => row.status !== 'archived' && !excludedParents.has(row.id),
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const name = values.name.trim()
    if (!name) {
      setFormError('Name is required')
      return
    }
    if (!values.category_id) {
      setFormError('Category is required')
      return
    }
    const category = categories.find((c) => c.id === values.category_id)
    if (
      category &&
      category.environment !== 'either' &&
      category.environment !== values.environment
    ) {
      setFormError(
        `Category ${category.name} may not label an ${values.environment} location`,
      )
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const saveError = await onSubmit({ ...values, name })
      if (saveError) setFormError(saveError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="loc-form"
      aria-label={initial ? 'Edit location' : 'New location'}
      onSubmit={(e) => void handleSubmit(e)}
    >
      <h2>{initial ? `Edit ${initial.name}` : 'New location'}</h2>
      {formError && (
        <p role="alert" className="auth-error">
          {formError}
        </p>
      )}

      <label htmlFor="loc-name">Name</label>
      <input
        id="loc-name"
        value={values.name}
        onChange={(e) => setValues((prev) => ({ ...prev, name: e.target.value }))}
      />

      <label htmlFor="loc-code">Code</label>
      <input
        id="loc-code"
        value={values.code}
        onChange={(e) => setValues((prev) => ({ ...prev, code: e.target.value }))}
      />

      <label htmlFor="loc-category">Category</label>
      <select
        id="loc-category"
        value={values.category_id}
        onChange={(e) => setValues((prev) => ({ ...prev, category_id: e.target.value }))}
      >
        <option value="">Select a category</option>
        {categories.map((category) => (
          <option
            key={category.id}
            value={category.id}
            disabled={!category.is_active && category.id !== initial?.category_id}
          >
            {category.name}
          </option>
        ))}
      </select>

      <label htmlFor="loc-environment">Environment</label>
      <select
        id="loc-environment"
        value={values.environment}
        onChange={(e) => setValues((prev) => ({ ...prev, environment: e.target.value }))}
      >
        {ENVIRONMENTS.map((env) => (
          <option key={env} value={env}>
            {env}
          </option>
        ))}
      </select>

      <label htmlFor="loc-parent">Parent location</label>
      <select
        id="loc-parent"
        value={values.parent_id}
        onChange={(e) => setValues((prev) => ({ ...prev, parent_id: e.target.value }))}
      >
        <option value="">No parent (top level)</option>
        {parentOptions.map((parent) => (
          <option key={parent.id} value={parent.id}>
            {parent.name}
          </option>
        ))}
      </select>

      <label htmlFor="loc-access">Access level</label>
      <select
        id="loc-access"
        value={values.access_level}
        onChange={(e) => setValues((prev) => ({ ...prev, access_level: e.target.value }))}
      >
        {ACCESS_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>

      <label htmlFor="loc-description">Description</label>
      <textarea
        id="loc-description"
        rows={3}
        value={values.description}
        onChange={(e) => setValues((prev) => ({ ...prev, description: e.target.value }))}
      />

      <div className="loc-form-actions">
        <button type="submit" className="btn" disabled={submitting}>
          {initial ? 'Save changes' : 'Create location'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function Locations() {
  const { schoolId } = useAuth()
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LocationRow | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryEnv, setCategoryEnv] = useState('either')
  const [categoryError, setCategoryError] = useState('')

  const fetchResults = useCallback(
    () =>
      Promise.all([
        supabase
          .from('locations')
          .select(LOCATION_COLUMNS)
          .order('name', { ascending: true }),
        supabase
          .from('location_categories')
          .select(CATEGORY_COLUMNS)
          .order('name', { ascending: true }),
      ]),
    [],
  )

  const applyResults = useCallback(
    (locationResult: QueryResult, categoryResult: QueryResult) => {
      if (locationResult.error) {
        setError(locationResult.error.message)
      } else {
        setLocations((locationResult.data ?? []) as LocationRow[])
      }
      if (categoryResult.error) {
        setError(categoryResult.error.message)
      } else {
        setCategories((categoryResult.data ?? []) as CategoryRow[])
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void fetchResults().then(([locationResult, categoryResult]) => {
      if (cancelled) return
      applyResults(locationResult, categoryResult)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchResults, applyResults])

  const load = useCallback(async () => {
    const [locationResult, categoryResult] = await fetchResults()
    applyResults(locationResult, categoryResult)
    setLoading(false)
  }, [fetchResults, applyResults])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return locations.filter(
      (row) =>
        (statusFilter === 'all' || row.status === statusFilter) &&
        (categoryFilter === 'all' || row.category_id === categoryFilter) &&
        (term === '' || row.name.toLowerCase().includes(term)),
    )
  }, [locations, statusFilter, categoryFilter, search])

  const ordered = useMemo(() => orderTree(filtered), [filtered])

  async function handleSave(values: FormValues): Promise<string | null> {
    const payload = {
      parent_id: values.parent_id || null,
      category_id: values.category_id,
      name: values.name,
      code: values.code.trim() || null,
      description: values.description.trim() || null,
      environment: values.environment,
      access_level: values.access_level,
    }
    setError('')
    if (editing) {
      const { error: updateError } = await supabase
        .from('locations')
        .update(payload)
        .eq('id', editing.id)
      if (updateError) return updateError.message
    } else {
      if (!schoolId) return 'No school is assigned to this account.'
      const { error: insertError } = await supabase
        .from('locations')
        .insert({ school_id: schoolId, ...payload })
      if (insertError) return insertError.message
    }
    setCreating(false)
    setEditing(null)
    await load()
    return null
  }

  async function handleArchive(locationId: string) {
    setError('')
    const { error: archiveError } = await supabase
      .from('locations')
      .update({ status: 'archived' })
      .eq('id', locationId)
    setConfirmId(null)
    if (archiveError) {
      setError(archiveError.message)
      return
    }
    await load()
  }

  async function handleToggleCategory(category: CategoryRow) {
    setError('')
    const { error: toggleError } = await supabase
      .from('location_categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id)
    if (toggleError) {
      setError(toggleError.message)
      return
    }
    await load()
  }

  async function handleAddCategory(event: FormEvent) {
    event.preventDefault()
    const name = categoryName.trim()
    if (!name) {
      setCategoryError('Category name is required')
      return
    }
    if (!schoolId) {
      setCategoryError('No school is assigned to this account.')
      return
    }
    setCategoryError('')
    const { error: insertError } = await supabase
      .from('location_categories')
      .insert({ school_id: schoolId, name, environment: categoryEnv })
    if (insertError) {
      setCategoryError(insertError.message)
      return
    }
    setCategoryName('')
    setCategoryEnv('either')
    await load()
  }

  return (
    <main className="admin-page">
      <h1>School Locations</h1>
      <p className="admin-subtitle">
        Manage buildings, rooms, and outdoor areas for your school. These records are
        user-managed and are not proof of anyone&apos;s actual location.
      </p>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading locations…</p>
      ) : (
        <>
          <section aria-label="Locations">
            <div className="loc-toolbar">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditing(null)
                  setCreating(true)
                }}
              >
                Add location
              </button>
              <select
                aria-label="Status filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Category filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Search locations"
                type="search"
                placeholder="Search locations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {(creating || editing) && (
              <LocationForm
                key={editing?.id ?? 'new'}
                categories={categories}
                locations={locations}
                initial={editing}
                onSubmit={handleSave}
                onCancel={() => {
                  setCreating(false)
                  setEditing(null)
                }}
              />
            )}

            {ordered.length === 0 ? (
              <p className="loc-empty">
                {locations.length === 0
                  ? 'No locations yet. Add your first location.'
                  : 'No locations match the current filters.'}
              </p>
            ) : (
              <ul className="loc-list">
                {ordered.map(({ row, depth }) => {
                  const category = categoryById.get(row.category_id)
                  return (
                    <li
                      key={row.id}
                      className="loc-row"
                      style={{ paddingLeft: `${0.75 + depth}rem` }}
                    >
                      <div className="loc-head">
                        <span className="loc-name">{row.name}</span>
                        <span className="loc-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setCreating(false)
                              setEditing(row)
                            }}
                          >
                            Edit
                          </button>
                          {row.status !== 'archived' && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setConfirmId(row.id)}
                            >
                              Archive
                            </button>
                          )}
                        </span>
                      </div>
                      <span className="loc-meta">
                        {row.code ? `${row.code} · ` : ''}
                        {category?.name ?? 'Uncategorized'} · {row.environment} ·{' '}
                        {row.status}
                      </span>
                      {confirmId === row.id && (
                        <div
                          role="alertdialog"
                          aria-label={`Confirm archive of ${row.name}`}
                          className="loc-confirm"
                        >
                          <p>Archive “{row.name}”?</p>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleArchive(row.id)}
                          >
                            Confirm archive
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-label="Location categories" className="cat-section">
            <h2 className="admin-section-title">Location categories</h2>
            {categories.length === 0 ? (
              <p className="loc-empty">No categories available.</p>
            ) : (
              <ul className="cat-list">
                {categories.map((category) => (
                  <li key={category.id} className="cat-row">
                    <span className="cat-name">{category.name}</span>
                    <span className="cat-meta">{category.environment}</span>
                    <span className="cat-meta">
                      {category.is_active ? 'active' : 'inactive'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleToggleCategory(category)}
                    >
                      {category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="cat-form"
              aria-label="Add location category"
              onSubmit={(e) => void handleAddCategory(e)}
            >
              {categoryError && (
                <p role="alert" className="auth-error">
                  {categoryError}
                </p>
              )}
              <div className="cat-field">
                <label htmlFor="cat-name">Category name</label>
                <input
                  id="cat-name"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
              </div>
              <div className="cat-field">
                <label htmlFor="cat-env">Category environment</label>
                <select
                  id="cat-env"
                  value={categoryEnv}
                  onChange={(e) => setCategoryEnv(e.target.value)}
                >
                  <option value="indoor">indoor</option>
                  <option value="outdoor">outdoor</option>
                  <option value="either">either</option>
                </select>
              </div>
              <button type="submit" className="btn">
                Add category
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  )
}
