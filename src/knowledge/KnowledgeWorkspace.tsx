'use client'
import { useEffect, useRef, useState } from 'react'
import type { KnowledgeKind } from './content'
import { emptyKnowledgeBody } from './content'
import { KnowledgeRichTextEditor } from './RichTextEditor'
import { KnowledgeRichText } from './RichText'

type Summary = { id: string; title: string; slug: string; parent: string | null; published: number }
type Page = {
  id: string
  title: string
  slug: string
  parent: string | null
  body: unknown
  visibility: 'public' | 'private'
  revision: number
  published: boolean
  attachments: { id: string; filename: string; size: number }[]
}
type Result = {
  message?: string
  doc: Page
  docs: Summary[]
  next: string | null
  revision: number
  versions: { revision: number; title: string; body: unknown; createdAt: string }[]
}
export function KnowledgeWorkspace({
  site,
  kind,
  prefix,
  id,
  permissions,
  initial,
  manage,
}: {
  site: string
  kind: KnowledgeKind
  prefix: string
  id: string
  permissions: string[]
  initial: { docs: Summary[]; next: string | null }
  manage: boolean
}) {
  const history = manage && permissions.includes(`${kind}:read-history`)
  const [docs, setDocs] = useState(initial.docs),
    [next, setNext] = useState(initial.next)
  const [doc, setDoc] = useState<Page | null>(null),
    [baseline, setBaseline] = useState('')
  const [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<
    { revision: number; title: string; body: unknown; createdAt: string }[]
  >([])
  const dirty = !!doc && JSON.stringify(doc) !== baseline,
    dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const endpoint = `/api/knowledge?site=${encodeURIComponent(site)}&kind=${kind}`
  const link = (page: Summary) =>
    `${prefix}/${kind}/${page.id}/${encodeURIComponent(page.slug)}?${new URLSearchParams({ site, ...(manage ? { manage: '1' } : {}) })}`
  const read = async (url: string) => {
    const response = await fetch(url, { cache: 'no-store' })
    const value = (await response.json()) as Result
    if (!response.ok) throw Error(value.message || 'Content is unavailable.')
    return value
  }
  useEffect(() => {
    if (!id) return
    let active = true
    void read(`${endpoint}&id=${encodeURIComponent(id)}${history ? '&draft=1' : ''}`)
      .then((value) => {
        if (active) {
          setDoc(value.doc)
          setBaseline(JSON.stringify(value.doc))
        }
      })
      .catch((cause) => {
        if (active) setMessage(cause.message)
      })
    return () => {
      active = false
    }
  }, [endpoint, id, history])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const leave = (event: MouseEvent) => {
      if (
        dirtyRef.current &&
        event.target instanceof Element &&
        event.target.closest('a[href]') &&
        !window.confirm('Discard unsaved page changes?')
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', leave, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', leave, true)
    }
  }, [])
  const list = async (after = '') => {
    setBusy(true)
    try {
      const value = await read(
        `${endpoint}&search=${encodeURIComponent(search)}&after=${encodeURIComponent(after)}${history ? '&draft=1' : ''}`,
      )
      setDocs(after ? [...docs, ...value.docs] : value.docs)
      setNext(value.next)
      setMessage('')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }
  const save = async (action: 'save' | 'publish' | 'unpublish' | 'delete') => {
    if (!doc || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...doc,
          action,
          expectedRevision: doc.revision,
          operationKey: crypto.randomUUID(),
        }),
      })
      const value = (await response.json()) as Result
      if (!response.ok)
        throw Error(
          response.status === 409
            ? 'This page changed elsewhere. Your draft is retained. Reload and compare before saving.'
            : value.message || 'The page could not be saved.',
        )
      const saved = {
        ...doc,
        revision: value.revision,
        published: action === 'publish' ? true : action === 'unpublish' ? false : doc.published,
      }
      setDoc(action === 'delete' ? null : saved)
      setBaseline(action === 'delete' ? '' : JSON.stringify(saved))
      dirtyRef.current = false
      setMessage(action === 'delete' ? 'Page deleted.' : 'Page saved.')
      await list()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }
  const editable =
    history && !!doc && permissions.includes(`${kind}:${doc.revision ? 'edit' : 'create'}`)
  return (
    <main className="knowledge-workspace">
      <header>
        <a href={`/admin?site=${encodeURIComponent(site)}`}>VortiCause</a>
        <h1>{kind === 'wiki' ? 'Wiki' : 'Intranet'}</h1>
        <p>
          {kind === 'intranet'
            ? 'Internal pages and resources.'
            : 'Shared knowledge, with private pages protected by their ancestors.'}
        </p>
        {permissions.includes(`${kind}:read-history`) && (
          <a
            href={`${prefix}/${kind}?${new URLSearchParams({ site, ...(!manage ? { manage: '1' } : {}) })}`}
          >
            {manage ? 'Published view' : 'Manage pages'}
          </a>
        )}
      </header>
      <div className="knowledge-columns">
        <aside aria-label="Page hierarchy">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void list()
            }}
          >
            <label>
              Search pages
              <input value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button disabled={busy}>Search</button>
          </form>
          {history && permissions.includes(`${kind}:create`) && (
            <button
              disabled={busy}
              onClick={() => {
                if (dirty && !window.confirm('Discard unsaved page changes?')) return
                const draft: Page = {
                  id: crypto.randomUUID(),
                  title: '',
                  slug: '',
                  parent: null,
                  body: emptyKnowledgeBody,
                  visibility: 'private',
                  revision: 0,
                  published: false,
                  attachments: [],
                }
                setDoc(draft)
                setBaseline('')
                setVersions([])
              }}
            >
              Create page
            </button>
          )}
          <ul>
            {docs.map((page) => (
              <li key={page.id}>
                <a href={link(page)}>{page.title}</a>
                {page.parent && <small> · Child page</small>}
                {history && !page.published && <small> · Draft</small>}
              </li>
            ))}
          </ul>
          {next && (
            <button disabled={busy} onClick={() => void list(next)}>
              Load more pages
            </button>
          )}
        </aside>
        <section aria-label="Page">
          {!doc && (
            <p>
              {kind === 'intranet'
                ? 'Welcome to the Intranet. Choose an internal page or create your first resource.'
                : 'Choose a page from the hierarchy.'}
            </p>
          )}
          {doc && (
            <>
              {editable ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save('save')
                  }}
                >
                  <fieldset disabled={busy}>
                    <label>
                      Title
                      <input
                        required
                        maxLength={200}
                        value={doc.title}
                        onChange={(event) => setDoc({ ...doc, title: event.target.value })}
                      />
                    </label>
                    <label>
                      URL slug
                      <input
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        maxLength={120}
                        value={doc.slug}
                        onChange={(event) => setDoc({ ...doc, slug: event.target.value })}
                      />
                    </label>
                    <label>
                      Parent
                      <select
                        value={doc.parent || ''}
                        disabled={!permissions.includes(`${kind}:manage-hierarchy`)}
                        onChange={(event) => setDoc({ ...doc, parent: event.target.value || null })}
                      >
                        <option value="">Top level</option>
                        {docs
                          .filter((page) => page.id !== doc.id)
                          .map((page) => (
                            <option value={page.id} key={page.id}>
                              {page.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    {kind === 'wiki' && (
                      <label>
                        Visibility
                        <select
                          disabled={!permissions.includes('wiki:manage-hierarchy')}
                          value={doc.visibility}
                          onChange={(event) =>
                            setDoc({ ...doc, visibility: event.target.value as Page['visibility'] })
                          }
                        >
                          <option value="private">Private</option>
                          <option value="public">Public when published</option>
                        </select>
                      </label>
                    )}
                    <KnowledgeRichTextEditor
                      key={`${doc.id}:${versions.length}`}
                      value={doc.body}
                      onChange={(body) =>
                        setDoc((previous) => (previous ? { ...previous, body } : null))
                      }
                    />
                    <button type="submit" disabled={!dirty}>
                      Save draft
                    </button>
                    {doc.revision > 0 && permissions.includes(`${kind}:publish`) && (
                      <>
                        <button type="button" onClick={() => void save('publish')}>
                          Publish
                        </button>
                        {doc.published && (
                          <button type="button" onClick={() => void save('unpublish')}>
                            Unpublish
                          </button>
                        )}
                      </>
                    )}
                    {doc.revision > 0 && permissions.includes(`${kind}:delete`) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm('Delete this page? Descendants will become unavailable.')
                          )
                            void save('delete')
                        }}
                      >
                        Delete page
                      </button>
                    )}
                  </fieldset>
                </form>
              ) : (
                <>
                  <h2>{doc.title}</h2>
                  <KnowledgeRichText body={doc.body} />
                </>
              )}
              <h3>Attachments</h3>
              <ul>
                {doc.attachments.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`${endpoint}&id=${doc.id}&file=${file.id}${history ? '&draft=1' : ''}`}
                    >
                      {file.filename}
                    </a>
                  </li>
                ))}
              </ul>
              {editable && doc.revision > 0 && (
                <label>
                  Upload attachment {dirty && '(save the page first)'}
                  <input
                    type="file"
                    disabled={busy || dirty}
                    accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv"
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      setBusy(true)
                      try {
                        const body = new FormData()
                        body.set('file', file)
                        const response = await fetch(
                          `/api/knowledge/attachments?site=${encodeURIComponent(site)}&kind=${kind}&id=${doc.id}`,
                          { method: 'POST', body },
                        )
                        const value = (await response.json()) as Page['attachments'][number] & {
                          message?: string
                        }
                        if (!response.ok) throw Error(value.message || 'Upload failed.')
                        const updated = { ...doc, attachments: [...doc.attachments, value] }
                        setDoc(updated)
                        setBaseline(JSON.stringify(updated))
                        setMessage('Attachment uploaded.')
                      } catch (cause) {
                        setMessage(cause instanceof Error ? cause.message : 'Upload failed.')
                      } finally {
                        setBusy(false)
                      }
                    }}
                  />
                </label>
              )}
              {history && doc.revision > 0 && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void read(`${endpoint}&id=${doc.id}&versions=1`)
                        .then((value) => setVersions(value.versions))
                        .catch((cause) => setMessage(cause.message))
                    }
                  >
                    View history
                  </button>
                  {versions.map((version) => (
                    <details key={version.revision}>
                      <summary>
                        Revision {version.revision} · {version.createdAt}
                      </summary>
                      <h3>{version.title}</h3>
                      <KnowledgeRichText body={version.body} />
                    </details>
                  ))}
                </>
              )}
              {history && (
                <p>
                  Tenant Administrators can read private content in this tenant. Their access is
                  audited.
                </p>
              )}
            </>
          )}
          <p role="status">{message || (dirty ? 'You have unsaved changes.' : '')}</p>
        </section>
      </div>
    </main>
  )
}
