'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Read explicitly scoped candidate pages. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { CorrespondenceBatches } from './correspondence-batches'
import type { correspondenceCandidates } from './correspondence-batch-selection'
import { useCorrespondenceBatchIO } from './useCorrespondenceBatchIO'

type Page = Awaited<ReturnType<typeof correspondenceCandidates>>
type Props = {
  api: string
  site: string
  batch: Awaited<ReturnType<CorrespondenceBatches['get']>>['doc']
  onPrepared: () => Promise<void>
  onDenied: (message: string) => void
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}
export function CorrespondenceBatchSelection({
  api,
  site,
  batch,
  onPrepared,
  onDenied,
  onDirty,
  onSaving,
}: Props) {
  const io = useCorrespondenceBatchIO(api, site, onDenied),
    [page, setPage] = useState<Page | null>(null),
    [search, setSearch] = useState(''),
    [after, setAfter] = useState(''),
    [from, setFrom] = useState(''),
    [through, setThrough] = useState(''),
    [givingOnly, setGivingOnly] = useState(true),
    [selected, setSelected] = useState<Record<string, Page['docs'][number]>>({}),
    [preparing, setPreparing] = useState(false),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState('')
  const active = useRef(true),
    continuePreparing = useRef(false)
  const busy = io.busy || preparing
  const { fail } = io
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      continuePreparing.current = false
    }
  }, [])
  useEffect(() => {
    onDirty(Object.keys(selected).length > 0)
  }, [selected, onDirty])
  useEffect(() => {
    onSaving(busy)
  }, [busy, onSaving])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setPage(null)
    void crmRead<Page>(
      `${api}/crm/correspondence-batches?${new URLSearchParams({ site, id: batch.id, view: 'candidates', search, after, from, through, givingOnly: String(givingOnly) })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPage(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) fail(error)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, batch.id, batch.config_revision, search, after, from, through, givingOnly, fail])
  const prepare = async () => {
    if (busy || !Object.keys(selected).length) return
    setPreparing(true)
    continuePreparing.current = true
    setNotice('')
    try {
      const current = await crmRead<Awaited<ReturnType<CorrespondenceBatches['get']>>>(
        `${api}/crm/correspondence-batches?${new URLSearchParams({ site, id: batch.id })}`,
      )
      if (current.doc.config_revision !== batch.config_revision || current.doc.status !== 'draft')
        throw new Error('The batch changed. Reload and review the recipient source.')
      let revision = current.doc.revision,
        count = 0
      for (const row of Object.values(selected)) {
        if (!active.current || !continuePreparing.current) break
        const saved = await io.post({
          action: 'prepare-recipient',
          id: batch.id,
          expectedRevision: revision,
          recipient: row.recipient,
        })
        if (!saved || !active.current) break
        revision = Number(saved.revision)
        count++
        setSelected((current) => {
          const next = { ...current }
          delete next[row.id]
          return next
        })
        setNotice(`${count} recipient reviews saved. Issuing requires batch approval.`)
      }
      if (active.current) await onPrepared()
    } catch (error) {
      fail(error as Error)
    } finally {
      if (active.current) setPreparing(false)
      continuePreparing.current = false
    }
  }
  return (
    <section aria-label="Batch recipient selection">
      <h4>Select recipients</h4>
      <p>
        Selection is retained across candidate pages. Preparing saves draft previews; documents are
        issued only after batch approval.
      </p>
      {io.error && <p role="alert">{io.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <label>
          Search batch recipients
          <input
            type="search"
            maxLength={100}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setAfter('')
            }}
          />
        </label>
        {batch.config.source !== 'contacts' && (
          <>
            <label>
              {batch.config.source === 'gifts' ? 'Gifts from' : 'Terms ending from'}
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setAfter('')
                }}
              />
            </label>
            <label>
              {batch.config.source === 'gifts' ? 'Gifts through' : 'Terms ending through'}
              <input
                type="date"
                value={through}
                onChange={(event) => {
                  setThrough(event.target.value)
                  setAfter('')
                }}
              />
            </label>
          </>
        )}
        {batch.config.kind === 'annual-statement' && (
          <label>
            <input
              type="checkbox"
              checked={givingOnly}
              onChange={(event) => {
                setGivingOnly(event.target.checked)
                setAfter('')
              }}
            />
            Only contacts with recorded gifts in the statement year
          </label>
        )}
        {loading && <p role="status">Loading permitted recipients…</p>}
        {page && (
          <>
            <p>
              {page.total.toLocaleString()} matching recipients. Showing {page.docs.length} on this
              page.
            </p>
            <button
              type="button"
              onClick={() =>
                setSelected((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    page.docs.filter((row) => !row.issued).map((row) => [row.id, row]),
                  ),
                }))
              }
            >
              Select this recipient page
            </button>
            <ul>
              {page.docs.map((row) => (
                <li key={row.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={row.issued}
                      checked={!!selected[row.id]}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = { ...current }
                          if (event.target.checked) next[row.id] = row
                          else delete next[row.id]
                          return next
                        })
                      }
                    />
                    {row.label} · {row.detail}
                    {row.issued && ' · Already issued in this batch'}
                  </label>
                </li>
              ))}
            </ul>
            {!page.docs.length && <p>No authorized recipients match these filters.</p>}
            <div className="vc-crm-toolbar">
              <button type="button" disabled={!after} onClick={() => setAfter('')}>
                First recipient candidates
              </button>
              <button type="button" disabled={!page.next} onClick={() => setAfter(page.next!)}>
                Next recipient candidates
              </button>
            </div>
          </>
        )}
        <p>{Object.keys(selected).length.toLocaleString()} recipients selected across pages.</p>
        <button
          type="button"
          disabled={!Object.keys(selected).length}
          onClick={() => void prepare()}
        >
          Prepare selected reviews
        </button>
        <button
          type="button"
          disabled={!Object.keys(selected).length}
          onClick={() => setSelected({})}
        >
          Clear recipient selection
        </button>
      </fieldset>
      {preparing && (
        <button
          type="button"
          onClick={() => {
            continuePreparing.current = false
          }}
        >
          Stop preparing more recipients
        </button>
      )}
    </section>
  )
}
