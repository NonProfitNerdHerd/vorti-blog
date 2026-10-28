'use client'
import { useRef, useState } from 'react'
import { useAuth, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { KnowledgeRichText } from '../knowledge/RichText'

interface Version { id: string; revision: number; title: string; body: unknown; layout?: unknown; actor: number; action: string; createdAt: string }
export function LegacyHistoryPanel() { return <HistoryPanel privateHistory={false} /> }
export function PrivateHistoryPanel() { return <HistoryPanel privateHistory /> }
function HistoryPanel({ privateHistory }: { privateHistory: boolean }) {
  const { id, collectionSlug, data } = useDocumentInfo(), { config } = useConfig(), { user } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [versions, setVersions] = useState<Version[]>([]), [selected, setSelected] = useState<Version | null>(null)
  const [next, setNext] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lineage = typeof data?.publishingLineage === 'string' ? data.publishingLineage : ''
  const permissions = Array.isArray(user?.platformPermissions) ? user.platformPermissions as string[] : []
  if (!permissions.includes('intranet:read-history') || (privateHistory
    ? data?.audience !== 'public' || !['posts', 'pages'].includes(collectionSlug) || !permissions.includes(`${collectionSlug}:read-history`)
    : !lineage.startsWith('legacy:') || (data?.audience === 'public' && !permissions.includes('pages:read-history')))) return null
  const title = privateHistory ? 'Intranet history before move' : 'Original Intranet history'
  async function load(before?: number) {
    setBusy(true); setError('')
    try {
      const params = privateHistory ? new URLSearchParams({ site: String(data.platformSite || 'default'), collection: collectionSlug, id: String(id) })
        : new URLSearchParams({ kind: 'intranet', site: String(data.platformSite || 'default'), id: lineage.slice(7), versions: '1' })
      if (before) params.set(privateHistory ? 'beforeVersion' : 'beforeRevision', String(before))
      const response = await fetch(`${config.routes.api}/${privateHistory ? 'publishing/private-history' : 'knowledge'}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw Error('Original history is unavailable or your readership changed.')
      const result = await response.json() as { versions: Version[]; next: number | null }
      setVersions(current => before ? [...current, ...result.versions] : result.versions)
      setNext(result.next)
      if (!before) setSelected(result.versions[0] || null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load original history.') }
    finally { setBusy(false) }
  }
  return <div className="field-type"><button type="button" ref={trigger} onClick={() => { setVersions([]); setSelected(null); setNext(null); dialog.current?.showModal(); void load() }}>{title}</button>
    <p>{privateHistory ? 'Private revisions require Intranet history permission and their original readership. They are excluded from public history.' : 'Original revisions remain immutable. New revisions appear in the shared editor’s history.'}</p>
    <dialog ref={dialog} aria-label={title} onClose={() => { setVersions([]); setSelected(null); setNext(null); trigger.current?.focus() }} style={{ width: 'calc(100% - 2rem)', maxWidth: '62rem', maxHeight: '85vh', overflow: 'auto' }}>
      <h2>{title}</h2>{error && <p role="alert">{error}</p>}{busy && <p role="status">Loading history…</p>}
      <nav aria-label="Original revisions">{versions.map(version => <button type="button" key={version.id} aria-current={selected?.id === version.id ? 'true' : undefined} onClick={() => setSelected(version)}>Revision {version.revision} · {version.createdAt.slice(0, 10)}</button>)}</nav>
      {selected && <article><h3>{selected.title}</h3><p>Revision {selected.revision} · {selected.action} · Account {selected.actor} · <time dateTime={selected.createdAt}>{selected.createdAt}</time></p><KnowledgeRichText body={selected.body} />{selected.layout != null && <details><summary>Preserved block layout</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(selected.layout, null, 2)}</pre></details>}</article>}
      {!busy && !error && !versions.length && <p>No original revisions were recorded.</p>}
      {next && <button type="button" disabled={busy} onClick={() => void load(next)}>Load earlier revisions</button>}
      <button type="button" onClick={() => dialog.current?.close()}>Close</button>
    </dialog>
  </div>
}
