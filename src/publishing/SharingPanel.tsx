'use client'
import { useRef, useState } from 'react'
import { useAuth, useConfig, useDocumentInfo, useFormModified, useFormProcessing } from '@payloadcms/ui'
import { RecipientChoices } from './SharingRecipients'

type Sharing = { readership: 'site' | 'restricted'; people: number[]; groups: string[]; revision: string; authorityRevision: number; published: boolean }
export function SharingPanel() {
  const { id, collectionSlug, data } = useDocumentInfo(), { config } = useConfig(), { user } = useAuth()
  const modified = useFormModified(), processing = useFormProcessing()
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const retry = useRef<{ fingerprint: string; key: string } | null>(null)
  const [sharing, setSharing] = useState<Sharing | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (data?.audience !== 'intranet' || !['posts', 'pages', 'media', 'categories', 'tags', 'menus', 'site-templates', 'saved-views'].includes(collectionSlug)) return null
  const permissions = Array.isArray(user?.platformPermissions) ? user.platformPermissions as string[] : []
  if (!permissions.includes('intranet:edit')) return null
  const site = String(data.platformSite || data.editorSite || 'default')
  async function open() {
    setBusy(true); setError(''); setSharing(null); retry.current = null; dialog.current?.showModal()
    try {
      const params = new URLSearchParams({ site, collection: collectionSlug, id: String(id) })
      const response = await fetch(`${config.routes.api}/publishing/sharing?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw Error('Sharing is unavailable for this record or your permissions changed.')
      setSharing(await response.json() as Sharing)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load sharing.') }
    finally { setBusy(false) }
  }
  function close() { if (busy) return; dialog.current?.close(); trigger.current?.focus() }
  async function save() {
    if (!sharing || busy) return
    setBusy(true); setError('')
    try {
      const body = { collection: collectionSlug, id: Number(id), readership: sharing.readership, people: sharing.people, groups: sharing.groups,
        expectedRevision: sharing.revision, expectedAuthorityRevision: sharing.authorityRevision }
      const fingerprint = JSON.stringify(body)
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() }
      const response = await fetch(`${config.routes.api}/publishing/sharing?site=${encodeURIComponent(site)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...body, key: retry.current.key }) })
      if (!response.ok) throw Error(response.status === 409 ? 'The document, draft, recipients, or permissions changed. Your selection is retained; close and reopen sharing to review the current revision.' : 'Sharing was not saved. Review your permissions and selected recipients.')
      window.location.reload()
    } catch (cause) { setError(cause instanceof DOMException && ['TimeoutError', 'AbortError'].includes(cause.name) ? 'The save response was interrupted. Your selection is retained; retrying the same selection safely checks the original operation.' : cause instanceof Error ? cause.message : 'Could not save sharing.'); setBusy(false) }
  }
  return <div className="field-type"><button ref={trigger} type="button" disabled={!id || modified || processing} onClick={() => void open()}>Manage readership</button>
    {(!id || modified) && <p>Save your content before changing readership.</p>}
    <p>Tenant Administrators can read all tenant content. Their access is audited.</p>
    <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault() }} onClose={() => trigger.current?.focus()} aria-label="Manage Intranet readership" style={{ maxWidth: '38rem', width: 'calc(100% - 2rem)', maxHeight: '85vh', overflow: 'auto' }}>
      <h2>Intranet readership</h2>{error && <p role="alert">{error}</p>}{busy && !sharing && <p role="status">Loading sharing…</p>}
      {sharing && <fieldset disabled={busy}><label>Who can read this document?<select value={sharing.readership} onChange={event => setSharing({ ...sharing, readership: event.target.value as Sharing['readership'] })}>
        <option value="site">Permitted site members</option><option value="restricted">Selected people and groups</option></select></label>
        {sharing.readership === 'restricted' && <><RecipientChoices group={false} value={sharing.people} setValue={people => setSharing({ ...sharing, people: people.map(Number) })} /><RecipientChoices group value={sharing.groups} setValue={groups => setSharing({ ...sharing, groups: groups.map(String) })} />
          <p>The author retains readership. Empty selections stay restricted. Parent Page restrictions also apply.</p></>}
        <p>Sharing grants readership. Editing, publishing, and history require separate permissions.</p>
        <button type="button" disabled={sharing.published && !permissions.includes('intranet:publish')} onClick={() => void save()}>{busy ? 'Saving…' : 'Save readership'}</button>
        {sharing.published && !permissions.includes('intranet:publish') && <p>Publishing permission is required to change readership of published content.</p>}
      </fieldset>}
      <button type="button" disabled={busy} onClick={close}>Close</button>
    </dialog>
  </div>
}
