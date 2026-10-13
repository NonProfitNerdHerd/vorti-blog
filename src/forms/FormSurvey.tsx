'use client'
import { useState } from 'react'
import { SurveyResults } from '@design-system/payload-design-core/forms/client'

export function FormSurvey({ formID }: { formID: string | number }) {
  const [filters, setFilters] = useState({ revision: '', from: '', to: '' })
  const [query, setQuery] = useState('')
  return <section aria-label="Survey reporting">
    <p>Defaults to the current published revision. Enter a historical revision ID from Entries to report it separately. Date filters use UTC.</p>
    <div className="forms-builder-actions">
      <label>Revision (optional)<input value={filters.revision} onChange={e => setFilters({ ...filters, revision: e.target.value })} /></label>
      <label>From<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
      <label>Through<input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      <button type="button" disabled={Boolean(filters.from && filters.to && filters.to < filters.from)} onClick={() => {
        const params = new URLSearchParams()
        if (filters.revision.trim()) params.set('revision', filters.revision.trim())
        if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`)
        if (filters.to) params.set('to', new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + 86400000).toISOString())
        setQuery(params.toString())
      }}>Update survey report</button>
    </div>
    <SurveyResults endpoint={`/api/forms-surveys/${encodeURIComponent(formID)}?${query}`} />
  </section>
}
