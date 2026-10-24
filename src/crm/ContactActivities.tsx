'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Explicit contact context starts a new authorized request. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { activityKinds, type Activity } from './activity-model'
import { crmRead } from './HouseholdWorkspace'
export function ContactActivities({
  api,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact: string
  onDirty: (dirty: boolean) => void
  onSaving: (busy: boolean) => void
}) {
  const [docs, setDocs] = useState<Activity[]>([]),
    [next, setNext] = useState<string | null>(null),
    [after, setAfter] = useState(''),
    [canEdit, setCanEdit] = useState(false)
  const [editor, setEditor] = useState<Activity | 'new' | null>(null),
    [kind, setKind] = useState<string>('note'),
    [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [date, setDate] = useState(''),
    [archived, setArchived] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false)
  const generation = useRef(0),
    operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const load = useCallback(async () => {
    const version = ++generation.current
    try {
      const data = await crmRead<{ docs: Activity[]; next: string | null; canEdit: boolean }>(
        `${api}/crm/activities?site=${encodeURIComponent(site)}&contact=${encodeURIComponent(contact)}&after=${encodeURIComponent(after)}`,
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
        setEditor(null)
        setCanEdit(false)
        setError((cause as Error).message)
      }
    }
  }, [api, site, contact, after])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate current async requests; this is a monotonic counter, not a DOM ref.
      generation.current++
    }
  }, [load])
  const change = () => {
    setDirty(true)
    onDirty(true)
    operation.current = null
  }
  const open = (doc: Activity | 'new') => {
    if (busy || (dirty && !window.confirm('Discard unsaved communication changes?'))) return
    setEditor(doc)
    setKind(doc === 'new' ? 'note' : doc.kind)
    setSubject(doc === 'new' ? '' : doc.subject)
    setBody(doc === 'new' ? '' : doc.body)
    setDate(doc === 'new' ? '' : doc.occurred_on)
    setArchived(doc === 'new' ? false : !!doc.archived)
    setDirty(false)
    onDirty(false)
    operation.current = null
  }
  const save = async () => {
    if (!editor || busy) return
    const version = generation.current,
      intent = {
        site,
        contact,
        id: editor === 'new' ? undefined : editor.id,
        expectedRevision: editor === 'new' ? undefined : editor.revision,
        values: { kind, subject, body, occurredOn: date, archived },
      },
      fingerprint = JSON.stringify(intent)
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true)
    onSaving(true)
    setError('')
    try {
      await crmRead(`${api}/crm/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...intent, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      operation.current = null
      setEditor(null)
      setDirty(false)
      onDirty(false)
      await load()
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) {
          setEditor(null)
          setDocs([])
          setCanEdit(false)
        }
      }
    } finally {
      setBusy(false)
      onSaving(false)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Chapter communications">
      <h3>Notes and communications</h3>
      <p>Record correspondence and conversations here. Recording an email does not send one.</p>
      {error && <p role="alert">{error}</p>}
      {canEdit && (
        <button type="button" disabled={busy} onClick={() => open('new')}>
          Record communication
        </button>
      )}
      <div className="vc-crm-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Subject</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.occurred_on}</td>
                <td>{doc.kind}</td>
                <td>
                  <button type="button" disabled={busy} onClick={() => open(doc)}>
                    {doc.subject}
                  </button>
                </td>
                <td>{doc.archived ? 'Archived' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!docs.length && <p>No communications in this chapter.</p>}
      <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
        First page
      </button>
      <button type="button" disabled={!next || busy} onClick={() => setAfter(next || '')}>
        Next page
      </button>
      {editor && canEdit && (
        <fieldset disabled={busy}>
          <legend>{editor === 'new' ? 'New communication' : 'Edit communication'}</legend>
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                change()
              }}
            >
              {activityKinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input
              maxLength={180}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value)
                change()
              }}
            />
          </label>
          <label>
            Occurred on
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                change()
              }}
            />
          </label>
          <label>
            Text
            <textarea
              maxLength={16000}
              rows={8}
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
                change()
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked)
                change()
              }}
            />
            Archived
          </label>
          <button
            type="button"
            disabled={!subject.trim() || !body.trim() || !date}
            onClick={() => void save()}
          >
            Save communication
          </button>
        </fieldset>
      )}
      {editor && !canEdit && (
        <article>
          <h4>{subject}</h4>
          <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p>
        </article>
      )}
      {editor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm('Discard unsaved communication changes?')) {
              setEditor(null)
              setDirty(false)
              onDirty(false)
            }
          }}
        >
          Close communication
        </button>
      )}
    </section>
  )
}
