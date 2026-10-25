'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Resolve explicit batch contexts and resumable processing state. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { CorrespondenceBatches } from './correspondence-batches'
import { CorrespondenceBatchEditor } from './CorrespondenceBatchEditor'
import { CorrespondenceBatchSelection } from './CorrespondenceBatchSelection'
import { CorrespondenceGeneration } from './CorrespondenceGeneration'
import { useCorrespondenceBatchIO } from './useCorrespondenceBatchIO'

type Page = Awaited<ReturnType<CorrespondenceBatches['get']>>
type List = Awaited<ReturnType<CorrespondenceBatches['list']>>
type Preview = Awaited<ReturnType<CorrespondenceBatches['preview']>>
type Props = {
  api: string
  site: string
  onDirty?: (value: boolean) => void
  onSaving?: (value: boolean) => void
  onHistory?: () => void
}
export function CorrespondenceBatchWorkspace(props: Props) {
  return <Batches key={`${props.api}:${props.site}`} {...props} />
}
function Batches({ api, site, onDirty, onSaving, onHistory }: Props) {
  const [list, setList] = useState<List | null>(null),
    [listAfter, setListAfter] = useState(''),
    [id, setID] = useState(''),
    [page, setPage] = useState<Page | null>(null),
    [after, setAfter] = useState(''),
    [editor, setEditor] = useState<'new' | 'edit' | null>(null),
    [editorDirty, setEditorDirty] = useState(false),
    [selectionDirty, setSelectionDirty] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [selectionBusy, setSelectionBusy] = useState(false),
    [processing, setProcessing] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [preview, setPreview] = useState<Preview | null>(null),
    [notice, setNotice] = useState(''),
    [denied, setDenied] = useState('')
  const active = useRef(true),
    keepProcessing = useRef(false),
    keepRefreshing = useRef(false),
    generation = useRef(0),
    previewGeneration = useRef(0)
  const listGeneration = useRef(0)
  const loseAccess = useCallback((message: string) => {
    keepProcessing.current = false
    keepRefreshing.current = false
    generation.current++
    listGeneration.current++
    previewGeneration.current++
    setPage(null)
    setList(null)
    setPreview(null)
    setID('')
    setEditor(null)
    setEditorDirty(false)
    setSelectionDirty(false)
    setEditorBusy(false)
    setSelectionBusy(false)
    setNotice('')
    setLoading(false)
    setDenied(message)
  }, [])
  const io = useCorrespondenceBatchIO(api, site, loseAccess),
    workerIO = useCorrespondenceBatchIO(api, site, loseAccess)
  const busy = io.busy || workerIO.busy || processing || refreshing || editorBusy || selectionBusy,
    dirty = editorDirty || selectionDirty
  const { fail } = io
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      keepProcessing.current = false
      keepRefreshing.current = false
    }
  }, [])
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
  const query = useCallback(
    (values: Record<string, string>) =>
      `${api}/crm/correspondence-batches?${new URLSearchParams({ site, ...values })}`,
    [api, site],
  )
  const loadList = useCallback(async () => {
    const version = ++listGeneration.current
    try {
      const result = await crmRead<List>(query({ after: listAfter }))
      if (active.current && version === listGeneration.current) {
        setList(result)
        setDenied('')
      }
    } catch (error) {
      fail(error as Error)
    }
  }, [query, listAfter, fail])
  const load = useCallback(
    async (target: string, cursor: string) => {
      const version = ++generation.current
      setLoading(true)
      try {
        const result = await crmRead<Page>(query({ id: target, after: cursor }))
        if (active.current && generation.current === version) {
          setPage(result)
          setDenied('')
        }
        return result
      } catch (error) {
        if (active.current && generation.current === version) fail(error as Error)
        return null
      } finally {
        if (active.current && generation.current === version) setLoading(false)
      }
    },
    [query, fail],
  )
  useEffect(() => {
    void loadList()
  }, [loadList, refresh])
  useEffect(() => {
    if (id) void load(id, after)
    else setPage(null)
  }, [id, after, refresh, load])
  useEffect(() => {
    setPreview(null)
    previewGeneration.current++
  }, [id])
  useEffect(() => {
    const focus = () => {
      if (id) void load(id, after)
      else void loadList()
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [id, after, load, loadList])
  useEffect(() => {
    if (!id || !page?.job || !['pending', 'running'].includes(page.job.status) || processing) return
    const timer = setTimeout(() => void load(id, after), 5000)
    return () => clearTimeout(timer)
  }, [id, after, page, processing, load])
  const discard = () =>
    !busy &&
    (!dirty || window.confirm('Discard unsaved batch configuration or recipient selection?'))
  const open = (next: string) => {
    if (!discard()) return
    generation.current++
    setID(next)
    setPage(null)
    setAfter('')
    setEditor(null)
    setEditorDirty(false)
    setSelectionDirty(false)
    setPreview(null)
    setNotice('')
    if (next === id) setRefresh((value) => value + 1)
  }
  const process = async (target = id) => {
    if (keepProcessing.current || !target) return
    keepProcessing.current = true
    setProcessing(true)
    let steps = 0
    try {
      while (active.current && keepProcessing.current) {
        const result = await workerIO.post({ action: 'process', id: target })
        if (!result || !active.current) break
        if (!result.worked) break
        steps++
        setNotice(
          `${steps} processing steps completed in this view. Issuance and PDF generation remain resumable.`,
        )
        if (steps % 4 === 0) await load(target, after)
      }
    } finally {
      keepProcessing.current = false
      if (active.current) {
        setProcessing(false)
        await load(target, after)
      }
    }
  }
  const approve = async () => {
    if (!page || busy || dirty || editor) return
    const result = await io.post({ action: 'approve', id, expectedRevision: page.doc.revision })
    if (result) {
      setSelectionDirty(false)
      await load(id, after)
      void process(id)
    }
  }
  const control = async (action: 'retry' | 'cancel') => {
    keepProcessing.current = false
    try {
      const current = await crmRead<Page>(query({ id }))
      if (
        !current.job ||
        (action === 'cancel' && !['pending', 'running'].includes(current.job.status))
      ) {
        await load(id, after)
        return
      }
      const result = await io.post({
        action,
        id,
        job: current.job.id,
        expectedFence: current.job.fence,
      })
      if (result) {
        await load(id, after)
        if (action === 'retry') void process(id)
      }
    } catch (error) {
      fail(error as Error)
    }
  }
  const refreshReviews = async () => {
    if (!page || busy || dirty || page.doc.status !== 'draft') return
    keepRefreshing.current = true
    setRefreshing(true)
    let cursor = '',
      count = 0
    try {
      do {
        const current = await crmRead<Page>(query({ id, after: cursor }))
        let revision = current.doc.revision
        for (const row of current.items) {
          if (!active.current || !keepRefreshing.current) break
          if (row.document) continue
          const result = await io.post({
            action: 'prepare-recipient',
            id,
            expectedRevision: revision,
            recipient: row.recipient,
          })
          if (!result) {
            keepRefreshing.current = false
            break
          }
          revision = Number(result.revision)
          count++
          setNotice(`${count} pending recipient reviews refreshed. Issued documents are unchanged.`)
        }
        cursor = current.next || ''
      } while (cursor && active.current && keepRefreshing.current)
    } catch (error) {
      fail(error as Error)
    } finally {
      keepRefreshing.current = false
      if (active.current) {
        setRefreshing(false)
        await load(id, after)
      }
    }
  }
  const showPreview = async (recipient: string) => {
    const version = ++previewGeneration.current
    setPreview(null)
    try {
      const result = await crmRead<Preview>(query({ id, view: 'preview', recipient }))
      if (active.current && version === previewGeneration.current) setPreview(result)
    } catch (error) {
      fail(error as Error)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="Bulk correspondence">
      <h3>Bulk correspondence</h3>
      <p>
        Prepare and review recipient previews, then explicitly approve the batch. Generation creates
        retained documents and private PDFs; it sends no email.
      </p>
      {!denied && (io.error || workerIO.error) && <p role="alert">{io.error || workerIO.error}</p>}
      {denied ? (
        <>
          <p role="alert">{denied}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Reload accessible batches
          </button>
        </>
      ) : (
        <>
          {notice && <p role="status">{notice}</p>}
          <div className="vc-crm-toolbar">
            {list?.canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (discard()) {
                    setID('')
                    setPage(null)
                    setEditor('new')
                    setEditorDirty(false)
                    setSelectionDirty(false)
                  }
                }}
              >
                Create correspondence batch
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
              Refresh correspondence batches
            </button>
            {onHistory && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (discard()) onHistory()
                }}
              >
                Open issued document history
              </button>
            )}
          </div>
          <ul>
            {list?.docs.map((row) => (
              <li key={row.id}>
                <button type="button" disabled={busy} onClick={() => open(row.id)}>
                  {row.name}
                </button>{' '}
                · {row.status}
              </li>
            ))}
          </ul>
          {list && !list.docs.length && <p>No accessible correspondence batches.</p>}
          <div className="vc-crm-toolbar">
            <button type="button" disabled={busy || !listAfter} onClick={() => setListAfter('')}>
              First correspondence batches
            </button>
            <button
              type="button"
              disabled={busy || !list?.next}
              onClick={() => setListAfter(list!.next!)}
            >
              Next correspondence batches
            </button>
          </div>
          {loading && <p role="status">Loading authorized batch…</p>}
          {editor && (
            <CorrespondenceBatchEditor
              key={editor === 'new' ? 'new' : id}
              api={api}
              site={site}
              initial={editor === 'edit' ? page?.doc : undefined}
              onDenied={loseAccess}
              onDirty={setEditorDirty}
              onSaving={setEditorBusy}
              onClose={() => {
                setEditorBusy(false)
                setEditor(null)
                setEditorDirty(false)
              }}
              onSaved={(saved) => {
                setEditorBusy(false)
                setEditor(null)
                setEditorDirty(false)
                setID(saved)
                setAfter('')
                setRefresh((value) => value + 1)
              }}
            />
          )}
          {page && (
            <section aria-label="Correspondence batch details">
              <h4>{page.doc.name}</h4>
              <p>
                Template: {page.doc.templateName} ({page.doc.config.kind.replaceAll('-', ' ')}).
                Issue date: {page.doc.config.issuedOn}. Issuer: {page.doc.config.issuerName}.
              </p>
              <p>
                {page.totals.total.toLocaleString()} prepared recipients;{' '}
                {page.totals.issued.toLocaleString()} issued. {page.totals.stale.toLocaleString()}{' '}
                reviews have configuration or access changes.
              </p>
              <p>
                Previews retain the reviewed values. All recipient sources are validated before
                issuance; refresh pending reviews to include later record changes.
              </p>
              {page.doc.templateArchived && (
                <p role="alert">
                  Choose an active template and refresh pending reviews before approving this batch.
                </p>
              )}
              {page.job && (
                <>
                  <p role="status">
                    Batch processing {page.job.status}. Completed processing steps:{' '}
                    {page.job.progress}.
                  </p>
                  {page.job.error && <p role="alert">{page.job.error}</p>}
                </>
              )}
              <p>
                Approved batches also continue through scheduled processing after this view closes.
                Cancellation keeps issued documents and their history.
              </p>
              <div className="vc-crm-toolbar">
                {page.canEdit && page.doc.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || !!editor}
                      onClick={() => {
                        if (discard()) {
                          setSelectionDirty(false)
                          setEditor('edit')
                        }
                      }}
                    >
                      Edit batch configuration
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy || dirty || !!editor || page.totals.total === page.totals.issued
                      }
                      onClick={() => void refreshReviews()}
                    >
                      Refresh all pending reviews
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        dirty ||
                        !!editor ||
                        !!page.totals.stale ||
                        page.doc.templateArchived ||
                        page.totals.total === page.totals.issued
                      }
                      onClick={() => void approve()}
                    >
                      Approve batch and issue documents
                    </button>
                  </>
                )}
                {page.canEdit && page.job && ['pending', 'running'].includes(page.job.status) && (
                  <button
                    type="button"
                    disabled={io.busy || refreshing}
                    onClick={() => void control('cancel')}
                  >
                    Cancel remaining batch processing
                  </button>
                )}
                {page.canEdit && page.job && ['failed', 'cancelled'].includes(page.job.status) && (
                  <button type="button" disabled={busy} onClick={() => void control('retry')}>
                    Retry batch processing
                  </button>
                )}
                {page.canEdit &&
                  page.job &&
                  ['completed', 'failed', 'cancelled'].includes(page.job.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void io
                          .post({ action: 'reopen', id, expectedRevision: page.doc.revision })
                          .then((result) => {
                            if (result) {
                              setAfter('')
                              setRefresh((value) => value + 1)
                            }
                          })
                      }}
                    >
                      Reopen remaining recipient reviews
                    </button>
                  )}
                {page.canEdit &&
                  !processing &&
                  !refreshing &&
                  (page.doc.status === 'approved' || page.totals.issued > 0) && (
                    <button type="button" disabled={busy} onClick={() => void process()}>
                      Continue batch processing
                    </button>
                  )}
                {processing && (
                  <button
                    type="button"
                    onClick={() => {
                      keepProcessing.current = false
                    }}
                  >
                    Continue in background
                  </button>
                )}
                {refreshing && (
                  <button
                    type="button"
                    onClick={() => {
                      keepRefreshing.current = false
                    }}
                  >
                    Stop refreshing more reviews
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => open('')}>
                  Close correspondence batch
                </button>
              </div>
              {page.canEdit && page.doc.status === 'draft' && !editor && (
                <CorrespondenceBatchSelection
                  key={`${id}:${page.doc.config_revision}`}
                  api={api}
                  site={site}
                  batch={page.doc}
                  onDenied={loseAccess}
                  onDirty={setSelectionDirty}
                  onSaving={setSelectionBusy}
                  onPrepared={async () => {
                    await load(id, after)
                    await loadList()
                  }}
                />
              )}
              <h4>Prepared and issued recipients</h4>
              <ul>
                {page.items.map((row) => (
                  <li key={row.id}>
                    <p>{row.source}</p>
                    <p>
                      {row.label} · {row.subject} ·{' '}
                      {row.document
                        ? 'Issued'
                        : row.stale
                          ? 'Review needs refreshing'
                          : 'Prepared review'}
                    </p>
                    <button type="button" onClick={() => void showPreview(row.id)}>
                      Preview correspondence for {row.label}
                    </button>
                    {!row.document && page.canEdit && page.doc.status === 'draft' && (
                      <button
                        type="button"
                        disabled={busy || dirty}
                        onClick={() => {
                          void io
                            .post({
                              action: 'remove-recipient',
                              id,
                              expectedRevision: page.doc.revision,
                              recipient: row.id,
                            })
                            .then((result) => {
                              if (result) setRefresh((value) => value + 1)
                            })
                        }}
                      >
                        Remove unissued recipient {row.label}
                      </button>
                    )}
                    {row.document && (
                      <>
                        <a
                          href={`${api}/crm/correspondence?${new URLSearchParams({ site, document: row.document, format: 'html' })}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Print document for {row.label}
                        </a>
                        {row.pdfReady && (
                          <>
                            {' '}
                            ·{' '}
                            <a
                              href={`${api}/crm/correspondence?${new URLSearchParams({ site, document: row.document, format: 'pdf' })}`}
                            >
                              Download PDF for {row.label}
                            </a>
                          </>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {!page.items.length && <p>No prepared recipients on this page.</p>}
              <div className="vc-crm-toolbar">
                <button type="button" disabled={busy || !after} onClick={() => setAfter('')}>
                  First prepared recipients
                </button>
                <button
                  type="button"
                  disabled={busy || !page.next}
                  onClick={() => setAfter(page.next!)}
                >
                  Next prepared recipients
                </button>
              </div>
              {preview && (
                <section aria-label="Batch recipient preview">
                  <h4>{preview.snapshot.subject}</h4>
                  <p>
                    Recipient: {preview.snapshot.recipient.name}. Issuer:{' '}
                    {preview.snapshot.issuer.name}.
                  </p>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {preview.snapshot.body}
                  </pre>
                  {preview.document && (
                    <CorrespondenceGeneration
                      api={api}
                      site={site}
                      document={preview.document}
                      onDenied={loseAccess}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      previewGeneration.current++
                      setPreview(null)
                    }}
                  >
                    Close batch recipient preview
                  </button>
                </section>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
