'use client'
import { useEffect, useState } from 'react'
import { FormHost } from './FormHost'
import { FormRenderer } from './FormRenderer'
import type { FormDefinition } from './model'

export function FormPlacement({ formID, editing }: { formID: string; editing?: boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; slug: string; title: string; definition: FormDefinition }>()
  const [error, setError] = useState<{ id: string; message: string }>()
  useEffect(() => {
    if (!formID) return
    const controller = new AbortController()
    fetch(`/api/forms-placement/${encodeURIComponent(formID)}`, { signal: controller.signal }).then(async response => {
      const body = await response.json() as { slug: string; title: string; definition: FormDefinition; message?: string }
      if (!response.ok) throw new Error(body.message || 'This form is unavailable.')
      setLoaded({ ...body, id: formID }); setError(undefined)
    }).catch(error => { if (!controller.signal.aborted) setError({ id: formID, message: error.message }) })
    return () => controller.abort()
  }, [formID])
  if (!formID) return editing ? <p>Select a published Form in the inspector. Build and publish its fields in Forms.</p> : null
  if (error?.id === formID) return <p role="status">{error.message}</p>
  if (loaded?.id !== formID) return <p role="status">Loading form…</p>
  return editing ? <section aria-label="Form block preview"><h2>{loaded.title}</h2><p>Preview only. Submissions, uploads, and reservations are disabled in the page editor.</p><FormRenderer definition={loaded.definition} preview /></section> : <FormHost slug={loaded.slug} embedded />
}
