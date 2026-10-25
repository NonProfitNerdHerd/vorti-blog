'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
type Props = {
  api: string
  site: string
  run: string
  column: number
  selected: string[]
  canAdd?: boolean
  onChoose: (value: string) => void
  onDenied: () => void
}
type Page = {
  docs: Array<{ value: string; occurrences: number; position: number }>
  total: number
  next: number | null
}
export function ImportSourceValues(props: Props) {
  return <SourceValues key={`${props.site}:${props.run}:${props.column}`} {...props} />
}
function SourceValues({
  api,
  site,
  run,
  column,
  selected,
  canAdd = true,
  onChoose,
  onDenied,
}: Props) {
  const [open, setOpen] = useState(false),
    [after, setAfter] = useState(0),
    [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let live = true
    const query = new URLSearchParams({
      site,
      id: run,
      view: 'values',
      column: String(column),
      after: String(after),
    })
    void crmRead<Page>(`${api}/crm/imports?${query}`, { signal: controller.signal })
      .then((result) => {
        if (live) {
          setPage(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!live || controller.signal.aborted) return
        setPage(null)
        if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) onDenied()
        else setError(cause instanceof Error ? cause.message : 'Unable to load source values.')
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [api, site, run, column, open, after, onDenied])
  return (
    <section aria-label="Distinct source values">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide distinct source values' : 'Browse distinct source values'}
      </button>
      {open && (
        <>
          {error && <p role="alert">{error}</p>}
          {page && (
            <>
              <p>
                {page.total} distinct values in this source column. Blank values follow
                preserve/clear behavior.
              </p>
              <ul>
                {page.docs.map((entry) => (
                  <li key={entry.position}>
                    <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {entry.value || '(blank)'}
                    </span>{' '}
                    ({entry.occurrences} rows){' '}
                    <button
                      type="button"
                      disabled={!canAdd || !entry.value.trim() || selected.includes(entry.value)}
                      onClick={() => onChoose(entry.value)}
                    >
                      Translate source value {entry.position}
                    </button>
                  </li>
                ))}
              </ul>
              {!!after && (
                <button
                  type="button"
                  onClick={() => {
                    setPage(null)
                    setAfter(0)
                  }}
                >
                  First source values
                </button>
              )}
              {page.next !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setPage(null)
                    setAfter(page.next!)
                  }}
                >
                  More source values
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
