'use client'
import React, { useRef, useState } from 'react'
import type { FormDefinition } from './model'
import { exportForm, importForm, type FormPackage } from './transfer'

export function FormTransfer({ value, onImport, readOnly, expanded = false }: {
  value: FormDefinition; onImport: (definition: FormDefinition) => void; readOnly?: boolean; expanded?: boolean
}) {
  const [candidate, setCandidate] = useState<FormPackage>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const result = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const report = () => requestAnimationFrame(() => result.current?.focus())
  async function load(selected: File) {
    const sequence = ++request.current
    setBusy(true); setError(''); setCandidate(undefined); setMessage('')
    try {
      if (selected.size > 1000000) throw new Error('Choose a JSON file smaller than 1 MB.')
      const imported = importForm(JSON.parse(await selected.text()))
      if (sequence === request.current) { setCandidate(imported); report() }
    } catch (cause) {
      if (sequence === request.current) { setError(cause instanceof SyntaxError ? 'This file is not valid JSON. Choose a Vorti form export.' : cause instanceof Error ? cause.message : 'The form could not be imported.'); report() }
    } finally { if (sequence === request.current) setBusy(false) }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportForm('Reusable form', value), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'form-definition.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Definition exported. No submitted answers or private integration settings are included.')
  }
  const content = <>
    <p>Move a versioned form definition between sites. Exports exclude submissions, actions, payment settings, private defaults, profile prefilling, collection connections, and allowed origins. Reconfigure these after importing.</p>
    <div className="forms-builder-actions"><button type="button" onClick={download}>Export definition</button>
      <label>Import JSON file<input ref={file} type="file" accept="application/json,.json" disabled={readOnly || busy} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void load(selected) }} /></label></div>
    <div ref={result} tabIndex={-1} aria-label="Import result" aria-live="polite">
      {busy && <p>Checking the file…</p>}{error && <p role="alert">{error}</p>}
      {candidate && <><h3>Import “{candidate.title}”?</h3><p>This replaces the working form definition. Existing entries and the published revision stay unchanged until you publish. The document title is unchanged. Imported fields and rules receive fresh IDs. You can undo this change.</p>
        <div className="forms-builder-actions"><button type="button" onClick={() => { setCandidate(undefined); file.current?.focus() }}>Cancel import</button>
          <button type="button" disabled={readOnly} onClick={() => { onImport(candidate.definition); setCandidate(undefined); setMessage('Imported into the working draft. Review configuration, then save the form.'); file.current?.focus() }}>Replace working definition</button></div></>}
      {message && <p role="status">{message}</p>}
    </div>
  </>
  return expanded ? <section className="forms-builder-panel" aria-label="Import / Export"><h2>Import / Export form definition</h2>{content}</section> : <details className="forms-builder-panel"><summary>Import / export form definition</summary>{content}</details>
}
