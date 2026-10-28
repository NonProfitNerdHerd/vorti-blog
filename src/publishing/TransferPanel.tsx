'use client'
import { useRef, useState } from 'react'
import { useAuth, useConfig, useDocumentInfo, useFormModified, useFormProcessing } from '@payloadcms/ui'

type Revision = { revision: string; authorityRevision: number; audience: 'public' | 'intranet'; slug: string }
export function TransferPanel() {
  const { id, collectionSlug, data } = useDocumentInfo(), { user } = useAuth(), { config } = useConfig()
  const modified = useFormModified(), processing = useFormProcessing()
  const modal = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const retry = useRef<{ fingerprint: string; key: string } | null>(null)
  const [revision, setRevision] = useState<Revision | null>(null), [mode, setMode] = useState<'copy' | 'move'>('copy')
  const [slug, setSlug] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const permissions = Array.isArray(user?.platformPermissions) ? user.platformPermissions as string[] : []
  const audience = data?.audience === 'intranet' ? 'intranet' : 'public', destination = audience === 'public' ? 'intranet' : 'public'
  const permission = (area: string, action: string) => `${area === 'intranet' ? 'intranet' : collectionSlug}:${action}`
  if (!['posts', 'pages'].includes(collectionSlug) || !permissions.includes(permission(audience, 'read-history')) || !permissions.includes(permission(destination, 'create'))) return null
  const site = String(data?.platformSite || data?.editorSite || 'default')
  const canMove = permissions.includes(permission(audience, 'edit')) && (data?._status !== 'published' || permissions.includes(permission(audience, 'publish')))
  async function open() {
    modal.current?.showModal(); setBusy(true); setError(''); setRevision(null); setMode('copy'); retry.current = null
    try {
      const params = new URLSearchParams({ site, collection: collectionSlug, id: String(id) })
      const response = await fetch(`${config.routes.api}/publishing/transfer?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw Error('Copy and move details are unavailable. Check your permissions and reload.')
      const current = await response.json() as Revision
      setRevision(current); setSlug(current.slug)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this document.') }
    finally { setBusy(false) }
  }
  async function save() {
    if (!revision || busy) return
    setBusy(true); setError('')
    const body = { collection: collectionSlug, id: Number(id), destination, mode, slug, expectedRevision: revision.revision, expectedAuthorityRevision: revision.authorityRevision }
    const fingerprint = JSON.stringify(body)
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() }
    try {
      const response = await fetch(`${config.routes.api}/publishing/transfer?site=${encodeURIComponent(site)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ ...body, key: retry.current.key }) })
      if (!response.ok) {
        const problem = await response.json().catch((): null => null) as { message?: string; errors?: Array<{ message?: string }> } | null
        throw Error(problem?.message || problem?.errors?.[0]?.message || 'Copy or move failed. Review the document revision, dependencies and permissions.')
      }
      const result = await response.json() as { id: number }
      window.location.assign(`${config.routes.admin}/collections/${collectionSlug}/${result.id}?${new URLSearchParams({ site, audience: destination })}`)
    } catch (cause) { setError(cause instanceof DOMException && ['TimeoutError', 'AbortError'].includes(cause.name) ? 'The response was interrupted. Retry the same details to safely check the original operation.' : cause instanceof Error ? cause.message : 'Could not copy or move.'); setBusy(false) }
  }
  return <div className="field-type"><button ref={trigger} type="button" disabled={!id || modified || processing} onClick={() => void open()}>Copy or move to {destination === 'intranet' ? 'Intranet' : 'Public'}</button>
    {(!id || modified) && <p>Save changes before copying or moving.</p>}
    <dialog ref={modal} aria-label="Copy or move content" onCancel={event => { if (busy) event.preventDefault() }} onClose={() => trigger.current?.focus()} style={{ maxWidth: '36rem', width: 'calc(100% - 2rem)' }}>
      <h2>Copy or move to {destination === 'intranet' ? 'Intranet' : 'Public'}</h2>{error && <p role="alert">{error}</p>}
      {busy && !revision && <p role="status">Loading…</p>}
      {revision && <fieldset disabled={busy}><label>Operation<select value={mode} onChange={event => setMode(event.target.value as 'copy' | 'move')}><option value="copy">Copy into a new draft</option>{canMove && <option value="move">Move this document into a draft</option>}</select></label>
        <label>Destination slug<input value={slug} onChange={event => setSlug(event.target.value)} maxLength={180} /></label>
        <p>The destination is a draft, available to authorized editors in that area. Review its media, categories, tags, links, hierarchy and Saved Views before publishing.</p>
        {mode === 'move' && <p>Moving preserves history and removes the current published version. Child Pages and assigned homepage settings must be resolved first.</p>}
        {audience === 'public' && <p>Previously public copies may still exist outside this site. Moving content internally cannot make those copies confidential.</p>}
        <button type="button" onClick={() => void save()}>{busy ? 'Saving…' : mode === 'copy' ? 'Create destination draft' : 'Move into a draft'}</button>
      </fieldset>}
      <button type="button" disabled={busy} onClick={() => modal.current?.close()}>Cancel</button>
    </dialog>
  </div>
}
