'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Each explicit site/kind starts a new authorized lookup. */
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { Classification, ClassificationKind } from './fundraising'
export function ClassificationPicker({
  api,
  site,
  kind,
  value,
  onChange,
}: {
  api: string
  site: string
  kind: ClassificationKind
  value: string
  onChange: (value: string) => void
}) {
  const [docs, setDocs] = useState<Classification[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setDocs([])
    setError('')
    const load = async () => {
      let after: string | null = '',
        all: Classification[] = []
      do {
        const page: { docs: Classification[]; next: string | null } = await crmRead(
          `${api}/crm/fundraising?site=${encodeURIComponent(site)}&kind=${kind}&after=${encodeURIComponent(after || '')}`,
          { signal: controller.signal },
        )
        all = [...all, ...page.docs.filter((d) => !d.archived)]
        after = page.next
        if (!controller.signal.aborted) setDocs(all)
      } while (after && !controller.signal.aborted)
    }
    void load().catch((cause) => {
      if (!controller.signal.aborted) {
        setDocs([])
        setError(cause.message)
      }
    })
    return () => controller.abort()
  }, [api, site, kind])
  const label = kind === 'campaigns' ? 'Campaign' : kind === 'appeals' ? 'Appeal' : 'Fund'
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {value && !docs.some((d) => d.id === value) && (
          <option value={value}>Current classification (archived or unavailable)</option>
        )}
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  )
}
