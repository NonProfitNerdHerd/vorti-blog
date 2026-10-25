'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { importDomains, type ImportDomain } from './import-model'

type Props = {
  api: string
  site: string
  domain: ImportDomain
  onUploaded: (id: string) => void
  onDirty: (dirty: boolean) => void
  onSaving: (saving: boolean) => void
  onDenied: () => void
}
type Receipt = { doc: { id: string; revision: number } }

/** Retains operation keys and the selected bytes after uncertain acknowledgements.
 * Uploading only publishes private source data; approval remains a later step. */
export function ImportSourceUpload(props: Props) {
  return <SourceUpload key={`${props.site}:${props.domain}`} {...props} />
}
function SourceUpload({ api, site, domain, onUploaded, onDirty, onSaving, onDenied }: Props) {
  const [name, setName] = useState(''),
    [sourceSystem, setSourceSystem] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true),
    fileInput = useRef<HTMLInputElement>(null),
    active = useRef(false),
    attempt = useRef<{
      signature: string
      createKey: string
      uploadKey: string
      receipt?: Receipt['doc']
    } | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const changed = () => {
    attempt.current = null
    onDirty(true)
    setError('')
  }
  const upload = async () => {
    if (active.current || !file) return
    active.current = true
    setBusy(true)
    setError('')
    onSaving(true)
    try {
      const extension = file.name.split('.').at(-1)?.toLowerCase(),
        limit = extension === 'csv' ? 50 * 1024 * 1024 : 8 * 1024 * 1024
      if (!['csv', 'xlsx'].includes(extension || '') || !file.size || file.size > limit)
        throw new Error('Choose a CSV file up to 50 MiB or an XLSX file up to 8 MiB.')
      if (!name.trim() || !sourceSystem.trim())
        throw new Error('Enter an import name and the source platform or dataset name.')
      const bytes = await file.arrayBuffer(),
        digest = await crypto.subtle.digest('SHA-256', bytes),
        sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        signature = JSON.stringify([site, domain, name, sourceSystem, file.name, file.size, sha256])
      if (!alive.current) return
      if (attempt.current?.signature !== signature)
        attempt.current = {
          signature,
          createKey: crypto.randomUUID(),
          uploadKey: crypto.randomUUID(),
        }
      const current = attempt.current!
      if (!current.receipt) {
        const result = await crmRead<Receipt>(`${api}/crm/imports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            site,
            domain,
            name,
            sourceSystem,
            filename: file.name,
            size: file.size,
            sha256,
            operationKey: current.createKey,
          }),
        })
        current.receipt = result.doc
      }
      if (!alive.current) return
      const query = new URLSearchParams({
        site,
        id: current.receipt.id,
        expectedRevision: String(current.receipt.revision),
        operationKey: current.uploadKey,
      })
      await crmRead<Receipt>(`${api}/crm/imports/source?${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!alive.current) return
      onDirty(false)
      onUploaded(current.receipt.id)
    } catch (cause) {
      if (!alive.current) return
      if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
        attempt.current = null
        setFile(null)
        if (fileInput.current) fileInput.current.value = ''
        setName('')
        setSourceSystem('')
        onDirty(false)
        onDenied()
      } else setError(cause instanceof Error ? cause.message : 'Unable to upload the source file.')
    } finally {
      active.current = false
      if (alive.current) {
        setBusy(false)
        onSaving(false)
      }
    }
  }
  return (
    <section aria-label="Upload import source">
      <h3>Import {importDomains[domain].label.toLowerCase()}</h3>
      <p>
        Upload a CSV or XLSX export. You will map fields and review matches before approving any
        changes.
      </p>
      <fieldset disabled={busy}>
        <label>
          Import name
          <input
            value={name}
            maxLength={180}
            onChange={(event) => {
              changed()
              setName(event.target.value)
            }}
          />
        </label>
        <label>
          Source platform or dataset
          <input
            value={sourceSystem}
            maxLength={120}
            onChange={(event) => {
              changed()
              setSourceSystem(event.target.value)
            }}
          />
        </label>
        <p>
          Use the same source name for repeat imports from the same dataset so its record
          identifiers can be matched.
        </p>
        <label>
          CSV or XLSX file
          <input
            type="file"
            ref={fileInput}
            accept=".csv,.xlsx"
            onChange={(event) => {
              changed()
              setFile(event.target.files?.[0] || null)
            }}
          />
        </label>
        <p>CSV: up to 50 MiB. XLSX: up to 8 MiB.</p>
        <button
          type="button"
          disabled={!file || !name.trim() || !sourceSystem.trim()}
          onClick={() => void upload()}
        >
          {busy ? 'Uploading source…' : 'Upload and preview'}
        </button>
      </fieldset>
      {error && (
        <p role="alert">{error} Retry with the same file and choices to continue this import.</p>
      )}
    </section>
  )
}
