'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
type Props = {
  api: string
  site: string
  run: string
  field: string
  label: string
  value: string
  disabled: boolean
  onChange: (id: string) => void
  onDenied: () => void
}
type Page = { docs: Array<{ id: string; label: string }>; next: string | null }
export function ImportReferenceMatch(props: Props) {
  return <ReferenceMatch key={`${props.site}:${props.run}:${props.field}`} {...props} />
}
function ReferenceMatch({
  api,
  site,
  run,
  field,
  label,
  value,
  disabled,
  onChange,
  onDenied,
}: Props) {
  const [query, setQuery] = useState(''),
    [after, setAfter] = useState(''),
    [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        site,
        id: run,
        view: 'references',
        field,
        search: query,
        after,
      })
      void crmRead<Page>(`${api}/crm/imports?${params}`, { signal: controller.signal })
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
          else setError(cause instanceof Error ? cause.message : 'Unable to load linked records.')
        })
    }, 200)
    return () => {
      live = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [api, site, run, field, query, after, onDenied])
  return (
    <fieldset disabled={disabled}>
      <legend>Find {label.toLowerCase()}</legend>
      <label>
        Search {label.toLowerCase()}
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setAfter('')
            setPage(null)
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <ul>
            {page.docs.map((doc) => (
              <li key={doc.id}>
                {doc.label}{' '}
                <button
                  type="button"
                  aria-pressed={doc.id === value}
                  onClick={() => onChange(doc.id)}
                >
                  Use {doc.label}
                </button>
              </li>
            ))}
          </ul>
          {!page.docs.length && <p>No matching active records on this page.</p>}
          {after && (
            <button
              type="button"
              onClick={() => {
                setAfter('')
                setPage(null)
              }}
            >
              First choices
            </button>
          )}
          {page.next && (
            <button
              type="button"
              onClick={() => {
                setAfter(page.next!)
                setPage(null)
              }}
            >
              More choices
            </button>
          )}
        </>
      )}
    </fieldset>
  )
}
