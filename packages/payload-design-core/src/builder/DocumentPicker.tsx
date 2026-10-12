'use client'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
export function DocumentPicker({
  collection,
  label,
  value,
  change,
}: {
  collection: string
  label: string
  value: string
  change: (value: string) => void
}) {
  const { config } = useConfig()
  const [search, setSearch] = useState(''),
    [docs, setDocs] = useState<Array<{ id: string | number; title?: string; name?: string; singular?: string }>>([]),
    [error, setError] = useState('')
  const selected = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const titleField = collection === 'post-types' ? 'singular' : ['categories', 'tags', 'saved-views'].includes(collection) ? 'name' : 'title'
        const params = new URLSearchParams({
          limit: '50',
          depth: '0',
          sort: titleField,
        })
        if (search)
          params.set(`where[${titleField}][like]`, search)
        const response = await fetch(
          `${config.serverURL ?? ''}${config.routes.api}/${collection}?${params}`,
          { signal: controller.signal, credentials: 'same-origin' },
        )
        if (!response.ok) throw new Error('Unable to load choices.')
        setDocs(((await response.json()) as { docs?: typeof docs }).docs ?? [])
        setError('')
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message)
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [collection, search, config.routes.api, config.serverURL])
  return (
    <fieldset>
      <legend>{label}</legend>
      <input
        aria-label={`Search ${label}`}
        placeholder="Search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="inspector-document-options">
        {selected
          .filter((id) => !docs.some((doc) => String(doc.id) === id))
          .map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked
                onChange={() => change(selected.filter((item) => item !== id).join(','))}
              />
              Selected document {id}
            </label>
          ))}
        {docs.map((doc) => (
          <label key={doc.id}>
            <input
              type="checkbox"
              checked={selected.includes(String(doc.id))}
              onChange={(event) =>
                change(
                  (event.target.checked
                    ? [...selected, String(doc.id)]
                    : selected.filter((id) => id !== String(doc.id))
                  ).join(','),
                )
              }
            />
            {doc.title ?? doc.name ?? doc.singular ?? String(doc.id)}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  )
}
