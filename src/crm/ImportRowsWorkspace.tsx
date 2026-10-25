'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { ImportRowReview } from './ImportRowReview'
import type { ImportRuns } from './import-runs'

type Props = {
  api: string
  site: string
  run: Awaited<ReturnType<ImportRuns['get']>>
  refresh: () => Promise<void>
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
  onDenied: () => void
}
export function ImportRowsWorkspace({
  api,
  site,
  run,
  refresh,
  onDirty,
  onSaving,
  onDenied,
}: Props) {
  const [page, setPage] = useState<Awaited<ReturnType<ImportRuns['rows']>> | null>(null),
    [after, setAfter] = useState(0),
    [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState<number | null>(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    const query = new URLSearchParams({
      site,
      id: run.doc.id,
      view: 'rows',
      after: String(after),
      filter,
    })
    void crmRead<Awaited<ReturnType<ImportRuns['rows']>>>(`${api}/crm/imports?${query}`)
      .then((result) => {
        if (live) {
          setPage(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!live) return
        setPage(null)
        setSelected(null)
        if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) {
          onDirty(false)
          onDenied()
        } else setError(cause instanceof Error ? cause.message : 'Unable to load import rows.')
      })
    return () => {
      live = false
    }
  }, [
    api,
    site,
    run.doc.id,
    run.doc.config_revision,
    run.doc.revision,
    run.job?.progress,
    run.job?.status,
    after,
    filter,
    version,
    onDenied,
    onDirty,
  ])
  const canLeave = () =>
    !saving && (!dirty || window.confirm('Discard unsaved row review choices?'))
  const clear = () => {
    setPage(null)
    setSelected(null)
    setDirty(false)
    onDirty(false)
  }
  return (
    <section aria-label="Import row decisions">
      <h3>Review source records</h3>
      <label>
        Show rows
        <select
          disabled={saving}
          value={filter}
          onChange={(event) => {
            if (canLeave()) {
              clear()
              setAfter(0)
              setFilter(event.target.value)
            }
          }}
        >
          <option value="all">All rows</option>
          <option value="unreviewed">Needs current review</option>
          <option value="pending">Not applied</option>
          <option value="applied">Applied results</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <p>
            {page.total} matching source rows. Values below are previews; open a row for its
            complete source.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <caption>Source records</caption>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Source preview</th>
                  <th>Decision</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.docs.map((row) => (
                  <tr key={row.number}>
                    <th>{row.number}</th>
                    <td>
                      {row.previewValues.join(' · ')}
                      {row.previewTruncated ? ' … (preview shortened)' : ''}
                    </td>
                    <td>
                      {row.decision || 'Not reviewed'}
                      {row.reviewSaved && !row.reviewConfigurationCurrent
                        ? ' (review needs refreshing)'
                        : ''}
                    </td>
                    <td>{row.appliedAction || 'Not applied'}</td>
                    <td>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (canLeave()) {
                            setSelected(row.number)
                            setDirty(false)
                            onDirty(false)
                          }
                        }}
                      >
                        Open row {row.number}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!page.docs.length && <p>No rows match this selection.</p>}
          {!!after && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (canLeave()) {
                  clear()
                  setAfter(0)
                }
              }}
            >
              First page
            </button>
          )}
          {page.next !== null && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (canLeave()) {
                  clear()
                  setAfter(page.next!)
                }
              }}
            >
              Next page
            </button>
          )}
        </>
      )}
      {selected !== null && (
        <ImportRowReview
          api={api}
          site={site}
          run={run}
          number={selected}
          reviewSaved={page?.docs.find((row) => row.number === selected)?.reviewSaved}
          applied={!!page?.docs.find((row) => row.number === selected)?.appliedAt}
          onSaved={async () => {
            setVersion((current) => current + 1)
            await refresh()
          }}
          onDirty={(value) => {
            setDirty(value)
            onDirty(value)
          }}
          onSaving={(value) => {
            setSaving(value)
            onSaving(value)
          }}
          onDenied={onDenied}
        />
      )}
    </section>
  )
}
