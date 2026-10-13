'use client'
import { useDocumentInfo } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { useEffect, useState } from 'react'
export const FormExportStatus: TextFieldClientComponent = () => {
  const { id } = useDocumentInfo()
  const [job, setJob] = useState<{ id: number; status: string; format?: string; expiresAt?: string; error?: string }>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const response = await fetch(`/api/forms-exports/job/${id}`, { signal: controller.signal })
        const result = await response.json() as NonNullable<typeof job> & { message?: string }
        if (!response.ok) throw new Error(result.message || 'Export could not be loaded.')
        setJob(result)
        if (['pending', 'running'].includes(result.status)) timer = setTimeout(() => void refresh(), 2000)
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [id])
  return <section aria-label="Export progress"><h2>Export progress</h2>{error ? <p role="alert">{error}</p> : job ? <>
    <p role="status">{job.status}{job.error ? ` — ${job.error}` : ''}</p>
    {job.status === 'complete' && <p><a href={`/api/forms-exports/job/${job.id}?download=1`}>Download {job.format?.toUpperCase()} export</a> · Expires {job.expiresAt}</p>}
    <p>Request a new export from the form’s Export entries panel when this download expires or if generation fails.</p>
  </> : <p>Loading export…</p>}</section>
}
