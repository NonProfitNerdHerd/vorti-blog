'use client'
import { useEffect, useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
export function ViewUsage() {
  const { id } = useDocumentInfo()
  const [items, setItems] = useState<Array<{ url: string; title: string; collection: string }>>([])
  useEffect(() => {
    if (id)
      fetch(`/api/content-views/usage?id=${id}`)
        .then(
          (r) =>
            r.json() as Promise<{
              usages?: Array<{ url: string; title: string; collection: string }>
            }>,
        )
        .then((r) => setItems(r.usages || []))
        .catch(() => {})
  }, [id])
  return (
    <section>
      <h3>Used on published content</h3>
      {items.length ? (
        <ul>
          {items.map((i, n) => (
            <li key={n}>
              <a href={i.url}>{i.title}</a> ({i.collection})
            </li>
          ))}
        </ul>
      ) : (
        <p>No published placements found. Publishing this view updates every linked placement.</p>
      )}
    </section>
  )
}
