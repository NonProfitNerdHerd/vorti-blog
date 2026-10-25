'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { ContactSummary } from './contacts'

type Page = { docs: ContactSummary[]; total: number; next: { label: string; id: string } | null }
type Props = {
  api: string
  site: string
  value: string
  disabled: boolean
  onChange: (id: string) => void
  onDenied: () => void
}
/** A choice, never automatic deduplication. Server review revalidates the target. */
export function ImportContactMatch(props: Props) {
  return <ContactMatch key={props.site} {...props} />
}
function ContactMatch({ api, site, value, disabled, onChange, onDenied }: Props) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState<Page | null>(null),
    [after, setAfter] = useState<Page['next']>(null),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        site,
        search: query,
        limit: '25',
        ...(after ? { afterID: after.id, afterLabel: after.label } : {}),
      })
      void crmRead<Page>(`${api}/crm/contacts?${params}`, { signal: controller.signal })
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
          else setError(cause instanceof Error ? cause.message : 'Unable to find constituents.')
        })
    }, 200)
    return () => {
      live = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [api, site, query, after, onDenied])
  return (
    <fieldset disabled={disabled}>
      <legend>Find an existing constituent</legend>
      <label>
        Search constituent name or email
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setAfter(null)
            setPage(null)
          }}
        />
      </label>
      <p>
        Select a record after checking the match. Shared names or email addresses do not prove two
        records are the same person.
      </p>
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <p>{page.total} matching constituents</p>
          <ul>
            {page.docs.map((contact) => (
              <li key={contact.id}>
                {contact.label}{' '}
                <button
                  type="button"
                  aria-pressed={value === contact.id}
                  onClick={() => onChange(contact.id)}
                >
                  Use {contact.label}
                </button>
              </li>
            ))}
          </ul>
          {!page.docs.length && <p>No matching constituents.</p>}
          {after && (
            <button
              type="button"
              onClick={() => {
                setPage(null)
                setAfter(null)
              }}
            >
              First matches
            </button>
          )}
          {page.next && (
            <button
              type="button"
              onClick={() => {
                setAfter(page.next)
                setPage(null)
              }}
            >
              More matches
            </button>
          )}
        </>
      )}
      {value && <p>Selected CRM identifier: {value}</p>}
    </fieldset>
  )
}
