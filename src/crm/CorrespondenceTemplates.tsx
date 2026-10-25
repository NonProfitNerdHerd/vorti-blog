'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the explicit chapter/page context. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import {
  correspondenceFields,
  correspondenceKinds,
  correspondenceTemplate,
  mergeCorrespondence,
  type CorrespondenceTemplate,
} from './correspondence-model'
import type { TemplateRow } from './correspondence'
type TemplateProps = {
  api: string
  site: string
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
}
export function CorrespondenceTemplates(props: TemplateProps) {
  return <TemplateEditor key={`${props.api}:${props.site}`} {...props} />
}
function TemplateEditor({ api, site, onDirty, onSaving }: TemplateProps) {
  const [docs, setDocs] = useState<TemplateRow[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [archived, setArchived] = useState(false),
    [canEdit, setCanEdit] = useState(false)
  const [editor, setEditor] = useState<TemplateRow | 'new' | null>(null),
    [values, setValues] = useState<CorrespondenceTemplate>({
      name: '',
      kind: 'general',
      subject: '',
      body: '',
      archived: false,
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const generation = useRef(0),
    operation = useRef<{ intent: string; key: string } | null>(null)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  const discard = () =>
    !busy && (!dirty || window.confirm('Discard unsaved correspondence template changes?'))
  const load = useCallback(async () => {
    const version = ++generation.current
    try {
      const data = await crmRead<{ docs: TemplateRow[]; next: string | null; canEdit: boolean }>(
        `${api}/crm/correspondence?${new URLSearchParams({ site, after, archived: String(archived) })}`,
      )
      if (version === generation.current) {
        setDocs(data.docs)
        setNext(data.next)
        setCanEdit(data.canEdit)
        setError('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setDocs([])
        setCanEdit(false)
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setEditor(null)
          setPreview(null)
          setDirty(false)
        }
      }
    }
  }, [api, site, after, archived])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Monotonic request generation invalidates pending reads.
      generation.current++
    }
  }, [load, refresh])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  const open = (row: TemplateRow | 'new') => {
    if (!discard()) return
    setEditor(row)
    setValues(
      row === 'new'
        ? { name: '', kind: 'general', subject: '', body: '', archived: false }
        : {
            name: row.name,
            kind: row.kind as CorrespondenceTemplate['kind'],
            subject: row.subject,
            body: row.body,
            archived: !!row.archived,
          },
    )
    setDirty(false)
    setPreview(null)
    operation.current = null
  }
  const change = (patch: Partial<CorrespondenceTemplate>) => {
    setValues((current) => ({ ...current, ...patch }))
    setDirty(true)
    setPreview(null)
    operation.current = null
  }
  const save = async () => {
    if (!editor || busy || !canEdit) return
    try {
      const valid = correspondenceTemplate(values as unknown as Record<string, unknown>)
      const body = {
          site,
          action: 'save-template',
          id: editor === 'new' ? undefined : editor.id,
          expectedRevision: editor === 'new' ? undefined : editor.revision,
          values: valid,
        },
        intent = JSON.stringify(body)
      if (operation.current?.intent !== intent)
        operation.current = { intent, key: crypto.randomUUID() }
      setBusy(true)
      setError('')
      await crmRead(`${api}/crm/correspondence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      operation.current = null
      setEditor(null)
      setDirty(false)
      setPreview(null)
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setEditor(null)
        setCanEdit(false)
        setDirty(false)
        setPreview(null)
      }
    } finally {
      setBusy(false)
    }
  }
  const showPreview = () => {
    try {
      const valid = correspondenceTemplate(values as unknown as Record<string, unknown>)
      const sample = Object.fromEntries(correspondenceFields.map((field) => [field, `[${field}]`]))
      setPreview({
        subject: mergeCorrespondence(valid.subject, sample),
        body: mergeCorrespondence(valid.body, sample),
      })
      setError('')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Correspondence templates">
      <h2>Correspondence templates</h2>
      <p>Each save retains a new version. Existing issued documents keep their original content.</p>
      {error && <p role="alert">{error}</p>}
      <div className="vc-crm-toolbar">
        <label>
          <input
            type="checkbox"
            checked={archived}
            disabled={busy}
            onChange={(event) => {
              if (discard()) {
                setArchived(event.target.checked)
                setAfter('')
                setEditor(null)
                setDirty(false)
                setPreview(null)
              }
            }}
          />{' '}
          Archived templates
        </label>
        {canEdit && (
          <button type="button" disabled={busy} onClick={() => open('new')}>
            Create correspondence template
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Version</th>
            <th>Editor</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.kind}</td>
              <td>{row.revision}</td>
              <td>
                <button type="button" disabled={busy} onClick={() => open(row)}>
                  Open {row.name}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && <p>No matching correspondence templates.</p>}
      <div className="vc-crm-toolbar">
        <button
          type="button"
          disabled={!after || busy}
          onClick={() => {
            if (discard()) {
              setAfter('')
              setEditor(null)
              setDirty(false)
              setPreview(null)
            }
          }}
        >
          First templates
        </button>
        <button
          type="button"
          disabled={!next || busy}
          onClick={() => {
            if (discard()) {
              setAfter(next!)
              setEditor(null)
              setDirty(false)
              setPreview(null)
            }
          }}
        >
          Next templates
        </button>
      </div>
      {editor && (
        <section aria-label="Correspondence template editor">
          <h3>{editor === 'new' ? 'New template' : `Template version ${editor.revision}`}</h3>
          <fieldset disabled={busy || !canEdit}>
            <label>
              Template name
              <input
                value={values.name}
                maxLength={180}
                onChange={(event) => change({ name: event.target.value })}
              />
            </label>
            <label>
              Template type
              <select
                value={values.kind}
                disabled={editor !== 'new'}
                onChange={(event) =>
                  change({ kind: event.target.value as CorrespondenceTemplate['kind'] })
                }
              >
                {correspondenceKinds.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label>
              Template subject
              <input
                value={values.subject}
                maxLength={240}
                onChange={(event) => change({ subject: event.target.value })}
              />
            </label>
            <label>
              Template body
              <textarea
                value={values.body}
                maxLength={16000}
                rows={12}
                onChange={(event) => change({ body: event.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.archived}
                onChange={(event) => change({ archived: event.target.checked })}
              />{' '}
              Archive template
            </label>
            <p>Merge fields: {correspondenceFields.map((field) => `{{${field}}}`).join(', ')}</p>
            <button type="button" disabled={!dirty} onClick={() => void save()}>
              Save template version
            </button>
          </fieldset>
          <button type="button" disabled={busy} onClick={showPreview}>
            Preview template
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                setEditor(null)
                setDirty(false)
                setPreview(null)
              }
            }}
          >
            Close template
          </button>
        </section>
      )}
      {preview && (
        <section aria-label="Template preview">
          <h3>{preview.subject}</h3>
          <p>
            Field markers below are examples. Recipient values are resolved from authorized records
            when preparing a document.
          </p>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.body}</div>
        </section>
      )}
    </section>
  )
}
