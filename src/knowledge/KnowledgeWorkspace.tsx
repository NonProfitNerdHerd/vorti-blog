'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { KnowledgeKind } from './content'
import { KnowledgeRichTextEditor } from './RichTextEditor'
import { KnowledgeRichText } from './RichText'
import { wikiOutline, type WikiView } from './wiki-view'

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
function WikiDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(min-width: 801px)')
    const update = () => setOpen(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      {children}
    </details>
  )
}
export function KnowledgeWorkspace({
  site,
  kind,
  prefix,
  permissions,
  initial,
  manage,
  view = manage ? 'edit' : 'read',
  initialDoc = null,
  initialVersions = [],
  account = null,
  loginHref = '/admin/login',
}: {
  site: string
  kind: KnowledgeKind
  prefix: string
  id: string
  permissions: string[]
  initial: { docs: Summary[]; next: string | null }
  manage: boolean
  view?: WikiView
  initialDoc?: Page | null
  initialVersions?: Result['versions']
  account?: { label: string } | null
  loginHref?: string
}) {
  const history = manage && permissions.includes(`${kind}:read-history`)
  const [docs, setDocs] = useState(initial.docs),
    [next, setNext] = useState(initial.next)
  const [doc, setDoc] = useState<Page | null>(initialDoc),
    [baseline, setBaseline] = useState(initialDoc ? JSON.stringify(initialDoc) : '')
  const [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [versions] =
    useState<{ revision: number; title: string; body: unknown; createdAt: string }[]>(
      initialVersions,
    )
  const dirty = !!doc && JSON.stringify(doc) !== baseline,
    dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const endpoint = `/api/knowledge?site=${encodeURIComponent(site)}&kind=${kind}`
  const link = (page: Summary) =>
    `${prefix}/${kind}/${page.id}/${encodeURIComponent(page.slug)}?${new URLSearchParams({ site, view })}`
  const read = async (url: string) => {
    const response = await fetch(url, { cache: 'no-store' })
    const value = (await response.json()) as Result
    if (!response.ok) throw Error(value.message || 'Content is unavailable.')
    return value
  }
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
      if (action !== 'delete' && doc.revision === 0)
        window.history.replaceState(
          null,
          '',
          `${prefix}/${kind}/${doc.id}/${encodeURIComponent(doc.slug)}?${new URLSearchParams({ site, view: 'edit' })}`,
        )
      setMessage(action === 'delete' ? 'Page deleted.' : 'Page saved.')
      await list()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }
  const editable =
    view === 'edit' &&
    history &&
    !!doc &&
    permissions.includes(`${kind}:${doc.revision ? 'edit' : 'create'}`)
  const home = prefix + '/' + kind + '?' + new URLSearchParams({ site })
  const createHref = home + '&view=edit&new=1'
  const articlePath =
    doc && doc.revision
      ? prefix + '/' + kind + '/' + doc.id + '/' + encodeURIComponent(doc.slug)
      : prefix + '/' + kind
  const tabHref = (nextView: WikiView) =>
    articlePath + '?' + new URLSearchParams({ site, view: nextView })
  const outline = wikiOutline(doc?.body)
  const canCreate = history || permissions.includes(kind + ':read-history')
  const tree = (parent: string | null, ancestors = new Set<string>()): ReactNode => (
    <ul>
      {docs
        .filter(
          (page) =>
            page.parent === parent ||
            (parent === null &&
              page.parent &&
              !docs.some((candidate) => candidate.id === page.parent)),
        )
        .filter((page) => !ancestors.has(page.id))
        .map((page) => (
          <li key={page.id}>
            <a href={link(page)} aria-current={doc?.id === page.id ? 'page' : undefined}>
              {page.title}
            </a>
            {history && !page.published && <small> Draft</small>}
            {tree(page.id, new Set([...ancestors, page.id]))}
          </li>
        ))}
    </ul>
  )
  return (
    <div className="wiki-shell">
      <a className="wiki-skip" href="#wiki-article">
        Skip to article
      </a>
      <header className="wiki-header">
        <a className="wiki-brand" href={home}>
          <span className="wiki-mark" aria-hidden="true">
            W
          </span>
          <span>
            VortiCause <strong>Wiki</strong>
            <small>Shared knowledge</small>
          </span>
        </a>
        <form
          role="search"
          className="wiki-search"
          onSubmit={(event) => {
            event.preventDefault()
            void list()
          }}
        >
          <label htmlFor="wiki-search">Search Wiki</label>
          <div>
            <input
              id="wiki-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Wiki"
            />
            <button disabled={busy}>Search</button>
          </div>
        </form>
        <nav className="wiki-account" aria-label="Account">
          <a href={'/admin?' + new URLSearchParams({ site })}>Main system</a>
          {account ? (
            <>
              <Link href="/admin/account" prefetch={false}>
                {account.label}
              </Link>
              <Link href="/admin/logout" prefetch={false}>
                Log out
              </Link>
            </>
          ) : (
            <a href={loginHref}>Log in</a>
          )}
        </nav>
      </header>
      <div className="wiki-grid">
        <aside className="wiki-navigation">
          <WikiDisclosure>
            <summary>Navigation</summary>
            <nav aria-label="Wiki navigation">
              <a href={home}>Wiki home</a>
              <a href={home + '#wiki-pages'}>Browse pages</a>
              {canCreate && permissions.includes(kind + ':create') && (
                <a href={createHref}>Create page</a>
              )}
            </nav>
            <h2>Pages</h2>
            <nav aria-label="Page hierarchy">{tree(null)}</nav>
            {!docs.length && <p>No pages available.</p>}
            {next && (
              <button disabled={busy} onClick={() => void list(next)}>
                Load more pages
              </button>
            )}
          </WikiDisclosure>
        </aside>
        <main id="wiki-article" className="wiki-article" tabIndex={-1}>
          <div className="wiki-context">
            {doc ? (
              <>
                <a href={home}>Wiki</a>
                <span aria-hidden="true"> / </span>
                {doc.visibility === 'private' ? 'Private article' : 'Public article'}
              </>
            ) : (
              'VortiCause knowledge base'
            )}
          </div>
          <h1>{doc ? doc.title || 'Create a page' : 'Welcome to the Wiki'}</h1>
          <nav className="wiki-tabs" aria-label="Page views">
            <a href={tabHref('read')} aria-current={view === 'read' ? 'page' : undefined}>
              Read
            </a>
            {permissions.includes(kind + ':read-history') &&
              (doc?.revision
                ? permissions.includes(kind + ':edit')
                : permissions.includes(kind + ':create')) && (
                <a href={tabHref('edit')} aria-current={view === 'edit' ? 'page' : undefined}>
                  Edit
                </a>
              )}
            {doc?.revision && permissions.includes(kind + ':read-history') ? (
              <a href={tabHref('history')} aria-current={view === 'history' ? 'page' : undefined}>
                History
              </a>
            ) : null}
            <button className="wiki-print" type="button" onClick={() => window.print()}>
              Print
            </button>
          </nav>
          <div role="status" className="wiki-status">
            {message || (dirty ? 'You have unsaved changes.' : '')}
          </div>
          {!doc && (
            <>
              <p>
                This is your shared reference library. Browse the pages or search for a topic to get
                started.
              </p>
              <section id="wiki-pages">
                <h2>Browse pages</h2>
                {docs.length ? (
                  <ul className="wiki-page-index">
                    {docs.map((page) => (
                      <li key={page.id}>
                        <a href={link(page)}>{page.title}</a>
                        {history && !page.published && <small> Draft</small>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No pages are available to you yet.
                    {canCreate && permissions.includes(kind + ':create') && (
                      <>
                        {' '}
                        <a href={createHref}>Create the first page</a>.
                      </>
                    )}
                  </p>
                )}
                {next && (
                  <button disabled={busy} onClick={() => void list(next)}>
                    Load more pages
                  </button>
                )}
              </section>
            </>
          )}
          {doc && view === 'history' ? (
            <section aria-label="Page history">
              <h2>Revision history</h2>
              <p>Saved revisions are shown newest first.</p>
              {versions.length ? (
                versions.map((version) => (
                  <details className="wiki-revision" key={version.revision}>
                    <summary>
                      Revision {version.revision} · {version.createdAt}
                    </summary>
                    <h3>{version.title}</h3>
                    <KnowledgeRichText
                      body={version.body}
                      anchorPrefix={'revision-' + version.revision + '-'}
                    />
                  </details>
                ))
              ) : (
                <p>No saved revisions are available.</p>
              )}
            </section>
          ) : (
            doc && (
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
                          onChange={(event) =>
                            setDoc({ ...doc, parent: event.target.value || null })
                          }
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
                              setDoc({
                                ...doc,
                                visibility: event.target.value as Page['visibility'],
                              })
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
                              window.confirm(
                                'Delete this page? Descendants will become unavailable.',
                              )
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
                  <KnowledgeRichText body={doc.body} />
                )}
                <section className="wiki-attachments" aria-label="Attachments">
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
                </section>
              </>
            )
          )}
          {history && (
            <p className="wiki-authority-note">
              Tenant Administrators can read private content in this tenant. Their access is
              audited.
            </p>
          )}
        </main>
        {doc && view === 'read' && (
          <aside className="wiki-contents">
            <WikiDisclosure>
              <summary>Contents</summary>
              <nav aria-label="Article contents">
                <a href="#wiki-article">Top</a>
                <ol>
                  {outline.map((heading) => (
                    <li
                      key={heading.id}
                      style={{ paddingInlineStart: Math.max(0, heading.level - 2) * 12 }}
                    >
                      <a href={'#' + heading.id}>{heading.title}</a>
                    </li>
                  ))}
                </ol>
              </nav>
              {!outline.length && <p>This article has no sections.</p>}
            </WikiDisclosure>
          </aside>
        )}
      </div>
      <footer className="wiki-footer">
        VortiCause Wiki ·{' '}
        <a href={'/admin?' + new URLSearchParams({ site })}>Back to the main system</a>
      </footer>
    </div>
  )
}
