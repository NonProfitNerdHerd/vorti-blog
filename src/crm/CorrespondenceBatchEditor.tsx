'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { TemplateRow } from './correspondence'
import type { CorrespondenceBatchConfig } from './correspondence-batch-model'
import { useCorrespondenceBatchIO } from './useCorrespondenceBatchIO'

type Props = {
  api: string
  site: string
  initial?: {
    id: string
    revision: number
    name: string
    config: CorrespondenceBatchConfig
    templateName?: string
  }
  onSaved: (id: string) => void
  onClose: () => void
  onDenied: (message: string) => void
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}
export function CorrespondenceBatchEditor({
  api,
  site,
  initial,
  onSaved,
  onClose,
  onDenied,
  onDirty,
  onSaving,
}: Props) {
  const io = useCorrespondenceBatchIO(api, site, onDenied),
    expected = useRef(initial?.revision),
    [name, setName] = useState(initial?.name || ''),
    [dirty, setDirty] = useState(false),
    [draft, setDraft] = useState(
      () =>
        initial?.config || {
          template: '',
          kind: 'general',
          source: 'contacts' as const,
          issuedOn: new Intl.DateTimeFormat('en-CA').format(new Date()),
          issuerName: '',
          issuerAddress: '',
          year: new Date().getFullYear(),
        },
    ),
    [templates, setTemplates] = useState<TemplateRow[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null)
  const { fail } = io
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving(io.busy)
  }, [io.busy, onSaving])
  useEffect(() => {
    const controller = new AbortController()
    void crmRead<{ docs: TemplateRow[]; next: string | null }>(
      `${api}/crm/correspondence?${new URLSearchParams({ site, after })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setTemplates(result.docs)
          setNext(result.next)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) fail(error)
      })
    return () => controller.abort()
  }, [api, site, after, fail])
  const change = <K extends keyof CorrespondenceBatchConfig>(
    field: K,
    value: CorrespondenceBatchConfig[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }
  return (
    <section aria-label="Correspondence batch editor">
      <h4>{initial ? 'Edit batch configuration' : 'Create correspondence batch'}</h4>
      {io.error && <p role="alert">{io.error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void io
            .post({
              action: 'save',
              id: initial?.id,
              expectedRevision: expected.current,
              name,
              values: draft,
            })
            .then((result) => {
              if (result) {
                setDirty(false)
                onSaved(String(result.id))
              }
            })
        }}
      >
        <fieldset disabled={io.busy}>
          <label>
            Batch name
            <input
              required
              maxLength={180}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setDirty(true)
              }}
            />
          </label>
          <label>
            Batch template
            <select
              required
              value={draft.template}
              onChange={(event) => {
                const template = templates.find((row) => row.id === event.target.value)
                setDraft((current) => ({
                  ...current,
                  template: event.target.value,
                  kind: template?.kind || 'general',
                  source:
                    template?.kind === 'gift-receipt'
                      ? 'gifts'
                      : template?.kind === 'membership-renewal'
                        ? 'memberships'
                        : 'contacts',
                }))
                setDirty(true)
              }}
            >
              <option value="">Choose template</option>
              {draft.template && !templates.some((row) => row.id === draft.template) && (
                <option value={draft.template}>
                  {initial?.templateName || 'Selected template'}
                </option>
              )}
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.kind.replaceAll('-', ' ')})
                </option>
              ))}
            </select>
          </label>
          <div className="vc-crm-toolbar">
            <button type="button" disabled={!after} onClick={() => setAfter('')}>
              First batch templates
            </button>
            <button type="button" disabled={!next} onClick={() => setAfter(next!)}>
              Next batch templates
            </button>
          </div>
          {draft.kind === 'thank-you' && (
            <label>
              Recipient source
              <select
                value={draft.source}
                onChange={(event) => change('source', event.target.value as 'contacts' | 'gifts')}
              >
                <option value="contacts">Contacts</option>
                <option value="gifts">Recorded gifts</option>
              </select>
            </label>
          )}
          {draft.kind === 'annual-statement' && (
            <label>
              Batch statement year
              <input
                required
                type="number"
                min={1900}
                max={9998}
                value={draft.year || ''}
                onChange={(event) => change('year', Number(event.target.value))}
              />
            </label>
          )}
          <label>
            Batch issue date
            <input
              required
              type="date"
              value={draft.issuedOn}
              onChange={(event) => change('issuedOn', event.target.value)}
            />
          </label>
          <label>
            Batch issuer name
            <input
              required
              maxLength={240}
              value={draft.issuerName}
              onChange={(event) => change('issuerName', event.target.value)}
            />
          </label>
          <label>
            Batch issuer address
            <textarea
              maxLength={2000}
              value={draft.issuerAddress}
              onChange={(event) => change('issuerAddress', event.target.value)}
            />
          </label>
          {initial && (
            <p>
              Changing this configuration requires refreshing every unissued recipient review before
              approval. Issued documents stay unchanged.
            </p>
          )}
          <button type="submit" disabled={!draft.template || (!!initial && !dirty)}>
            Save batch configuration
          </button>
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved batch configuration?')) {
                setDirty(false)
                onClose()
              }
            }}
          >
            Close batch configuration
          </button>
        </fieldset>
      </form>
    </section>
  )
}
