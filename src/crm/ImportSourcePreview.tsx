'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { ImportInspection, ImportSourceOptions } from './import-files'

type Props = {
  api: string
  site: string
  id: string
  revision: number
  kind: 'csv' | 'xlsx'
  canEdit: boolean
  initialOptions?: ImportSourceOptions
  onConfigured: () => Promise<void>
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportSourcePreview(props: Props) {
  return <SourcePreview key={`${props.site}:${props.id}:${props.revision}`} {...props} />
}
function SourcePreview({
  api,
  site,
  id,
  revision,
  kind,
  canEdit,
  initialOptions,
  onConfigured,
  onDirty,
  onSaving,
  onDenied,
}: Props) {
  const [options, setOptions] = useState<ImportSourceOptions>(
      initialOptions || {
        headerRow: 1,
        sheet: '',
        delimiter: ',',
      },
    ),
    [preview, setPreview] = useState<ImportInspection | null>(null),
    [sheets, setSheets] = useState<ImportInspection['sheets']>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true),
    active = useRef(false),
    operation = useRef<{ signature: string; key: string } | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const denied = (cause: unknown) => {
    if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
      setPreview(null)
      setSheets([])
      setOptions({ headerRow: 1, sheet: '', delimiter: ',' })
      operation.current = null
      onDirty(false)
      onDenied()
    } else setError(cause instanceof Error ? cause.message : 'Unable to inspect this source.')
  }
  const change = (next: ImportSourceOptions) => {
    setOptions(next)
    setPreview(null)
    operation.current = null
    setError('')
    onDirty(true)
  }
  const inspect = async () => {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      const query = new URLSearchParams({
        site,
        id,
        view: 'inspect',
        headerRow: String(options.headerRow),
        sheet: options.sheet,
        delimiter: options.delimiter,
      })
      const result = await crmRead<ImportInspection>(`${api}/crm/imports?${query}`)
      if (!alive.current) return
      setOptions(result.options)
      setSheets(result.sheets)
      setPreview(result)
    } catch (cause) {
      if (alive.current) denied(cause)
    } finally {
      active.current = false
      if (alive.current) setBusy(false)
    }
  }
  const configure = async () => {
    if (active.current || !preview || !canEdit) return
    active.current = true
    setBusy(true)
    setError('')
    onSaving(true)
    try {
      if (operation.current?.signature !== preview.signature)
        operation.current = { signature: preview.signature, key: crypto.randomUUID() }
      await crmRead(`${api}/crm/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          site,
          id,
          expectedRevision: revision,
          operationKey: operation.current.key,
          options: preview.options,
          signature: preview.signature,
        }),
      })
      if (!alive.current) return
      onDirty(false)
      onSaving(false)
      await onConfigured()
    } catch (cause) {
      if (alive.current) denied(cause)
    } finally {
      active.current = false
      if (alive.current) {
        setBusy(false)
        onSaving(false)
      }
    }
  }
  return (
    <section aria-label="Preview import source">
      <h3>Choose source columns</h3>
      <p>
        Preview the worksheet and header row before preparing records for mapping. No donor records
        are changed.
      </p>
      <fieldset disabled={busy}>
        <label>
          Header row
          <input
            type="number"
            min={1}
            step={1}
            value={options.headerRow}
            onChange={(event) => change({ ...options, headerRow: Number(event.target.value) })}
          />
        </label>
        {kind === 'csv' ? (
          <label>
            Column separator
            <select
              value={options.delimiter}
              onChange={(event) =>
                change({
                  ...options,
                  delimiter: event.target.value as ImportSourceOptions['delimiter'],
                })
              }
            >
              <option value=",">Comma</option>
              <option value=";">Semicolon</option>
              <option value={'\t'}>Tab</option>
            </select>
          </label>
        ) : (
          <label>
            Worksheet
            <select
              value={options.sheet}
              onChange={(event) => change({ ...options, sheet: event.target.value })}
            >
              {!options.sheet && <option value="">First worksheet</option>}
              {sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name}
                  {sheet.hidden ? ' (hidden)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => void inspect()}>
          Preview source
        </button>
        <button type="button" disabled={!preview || !canEdit} onClick={() => void configure()}>
          Use these columns
        </button>
      </fieldset>
      {busy && <p role="status">Loading source…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <p>
            Preview of up to 20 source rows. All rows will be processed after source configuration.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <caption>Source preview</caption>
              <thead>
                <tr>
                  <th>Source row</th>
                  {preview.headers.map((header, index) => (
                    <th key={index}>
                      {index + 1}. {header || '(blank header)'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.number}>
                    <th>{row.number}</th>
                    {preview.headers.map((_, index) => (
                      <td key={index}>{row.values[index] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.flatMap((row) =>
            row.issues.map((issue, index) => (
              <p key={`${row.number}:${index}`} role="alert">
                Row {row.number}, column {issue.column}: {issue.message}
              </p>
            )),
          )}
        </>
      )}
    </section>
  )
}
