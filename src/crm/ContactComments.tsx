'use client'
/* eslint-disable react-hooks/set-state-in-effect -- The selected record starts an authorized async read. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContactComment } from './comments'
import { crmRead } from './HouseholdWorkspace'

type Page = { docs: ContactComment[]; next: { date: string; id: string } | null; canPost: boolean }
export function ContactComments({ api, site, contact, onDirty, onSaving, onDenied }: {
  api: string; site: string; contact: string; onDirty: (value: boolean) => void;
  onSaving: (value: boolean) => void; onDenied: () => void
}) {
  const [page, setPage] = useState<Page | null>(null)
  const [recent, setRecent] = useState<ContactComment | null>(null)
  const [before, setBefore] = useState<Page['next']>(null)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<ContactComment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const query = new URLSearchParams({ site, contact })
    if (before) { query.set('beforeDate', before.date); query.set('beforeID', before.id) }
    const result = await crmRead<Page>(`${api}/crm/comments?${query}`, { signal })
    if (!signal.aborted) { setPage(result); if (!before) setRecent(result.docs[0] || null); setError('') }
  }, [api, site, contact, before])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal).catch((cause: Error & { status?: number }) => {
      if (!controller.signal.aborted) {
        setPage(null); setRecent(null); setError(cause.message)
        if ([401, 403].includes(Number(cause.status))) onDenied()
      }
    })
    return () => controller.abort()
  }, [load, revision, onDenied])
  const change = (value: string) => { setBody(value); onDirty(Boolean(value.trim())); operation.current = null }
  const reset = () => { setEditing(null); setBody(''); onDirty(false); operation.current = null }
  const save = async () => {
    if (busy || !body.trim()) return
    const fingerprint = JSON.stringify({ site, contact, body: body.trim(), id: editing?.id, revision: editing?.revision })
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true); onSaving(true); setError('')
    try {
      await crmRead(`${api}/crm/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, contact, body, id: editing?.id, expectedRevision: editing?.revision, operationKey: operation.current.key }) })
      reset(); setBefore(null); setRevision(value => value + 1)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false); onSaving(false) }
  }
  return <section className="vc-crm-domain vc-crm-comments-layout" aria-label="Constituent comments">
    <div className="vc-crm-comments-main">
    <h2>Comments</h2>
    {error && <p role="alert">{error}</p>}
    {page?.canPost && <div className="vc-crm-comment-composer">
      <label htmlFor="vc-crm-comment-body">{editing ? 'Edit your comment' : 'Add a comment'}</label>
      <textarea id="vc-crm-comment-body" value={body} maxLength={4000} onChange={event => change(event.target.value)} />
      <div><button type="button" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? 'Saving…' : editing ? 'Save comment' : 'Post comment'}</button>
        {editing && <button type="button" disabled={busy} onClick={reset}>Cancel edit</button>}</div>
    </div>}
    {page ? <ol className="vc-crm-comments">
      {page.docs.map(comment => <li key={comment.id}><article>
        <span className="vc-crm-comment-avatar" aria-hidden="true">{comment.author_label.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span>
        <div className="vc-crm-comment-content">
        <header><strong>{comment.author_label}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString()}</time>
          {comment.revision > 1 && <small>Edited</small>}</header>
        <p>{comment.body}</p>
        {comment.canEdit && <button type="button" disabled={busy} onClick={() => { setEditing(comment); change(comment.body) }}>Edit</button>}
        </div>
      </article></li>)}
      {!page.docs.length && <li>No comments yet.</li>}
    </ol> : <p role="status">Loading comments…</p>}
    {page?.next && <button type="button" onClick={() => setBefore(page.next)}>Older comments</button>}
    </div>
    <aside className="vc-crm-context-card vc-crm-comments-aside" aria-label="Recent comment">
      <h3>Recent comment</h3>
      {error ? <p role="alert">Unable to load recent comment.</p> : !page ? <p role="status">Loading comments…</p> : recent ? <>
        <p>{recent.body}</p>
        <small>{recent.author_label} · {new Date(recent.created_at).toLocaleDateString()}</small>
      </> : <p>No comments yet.</p>}
    </aside>
  </section>
}
