'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { ImportRuns } from './import-runs'
type Props = {
  api: string
  site: string
  run: Awaited<ReturnType<ImportRuns['get']>>
  onUploaded: () => Promise<void>
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportUploadResume({
  api,
  site,
  run,
  onUploaded,
  onDirty,
  onSaving,
  onDenied,
}: Props) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true),
    active = useRef(false),
    key = useRef(''),
    input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const resume = async () => {
    if (!file || active.current || !run.canEdit) return
    active.current = true
    setBusy(true)
    setError('')
    onSaving(true)
    try {
      if (file.size !== run.doc.file_size)
        throw Error('Select the original file with the same size and contents.')
      const bytes = await file.arrayBuffer(),
        hash = await crypto.subtle.digest('SHA-256', bytes),
        sha256 = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      if (sha256 !== run.doc.file_sha256)
        throw Error(
          'The selected file differs from the original. Start a new import for different contents.',
        )
      if (!alive.current) return
      if (!key.current) key.current = crypto.randomUUID()
      const query = new URLSearchParams({
        site,
        id: run.doc.id,
        expectedRevision: String(run.doc.revision),
        operationKey: key.current,
      })
      await crmRead(`${api}/crm/imports/source?${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!alive.current) return
      onDirty(false)
      onSaving(false)
      await onUploaded()
    } catch (cause) {
      if (!alive.current) return
      if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
        setFile(null)
        if (input.current) input.current.value = ''
        onDirty(false)
        onDenied()
      } else setError(cause instanceof Error ? cause.message : 'Unable to resume upload.')
    } finally {
      active.current = false
      if (alive.current) {
        setBusy(false)
        onSaving(false)
      }
    }
  }
  return (
    <section aria-label="Resume source upload">
      <h3>Resume interrupted upload</h3>
      <p>
        Select the original {run.doc.file_name}. Its size and checksum must match the saved import.
        Different contents require a new import.
      </p>
      <fieldset disabled={busy || !run.canEdit}>
        <label>
          Original source file
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null)
              onDirty(true)
              setError('')
            }}
          />
        </label>
        <button type="button" disabled={!file} onClick={() => void resume()}>
          Resume source upload
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
