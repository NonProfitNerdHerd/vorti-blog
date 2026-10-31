'use client'
import { useCallback, useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { ImportSourceUpload } from './ImportSourceUpload'
import { ImportRunWorkspace } from './ImportRunWorkspace'
import { importDomains, type ImportDomain } from './import-model'
import type { ImportRuns } from './import-runs'

type Props = { api: string; site: string }
type Context = Awaited<ReturnType<ImportRuns['context']>>
type Page = Awaited<ReturnType<ImportRuns['list']>>
export function ImportWorkspace(props: Props) {
  return <Imports key={props.site} {...props} />
}
function Imports({ api, site }: Props) {
  const [context, setContext] = useState<Context | null>(null),
    [page, setPage] = useState<Page | null>(null),
    [domain, setDomain] = useState<ImportDomain>(() => {
      const value =
        typeof window === 'undefined'
          ? null
          : new URLSearchParams(window.location.search).get('importDomain')
      return value && Object.hasOwn(importDomains, value) ? (value as ImportDomain) : 'contacts'
    }),
    [selected, setSelected] = useState(() =>
      typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).get('importID') || '',
    ),
    [creating, setCreating] = useState(false),
    [after, setAfter] = useState(''),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0)
  const deny = useCallback(() => {
    setContext(null)
    setPage(null)
    setSelected('')
    setCreating(false)
    setDirty(false)
    setError(
      'Import access is unavailable. Refresh after your chapter permissions have been checked.',
    )
  }, [])
  useEffect(() => {
    let live = true
    const load = () => {
      if (!site) return
      const query = new URLSearchParams({ site, view: 'context' })
      void crmRead<Context>(`${api}/crm/imports?${query}`)
        .then((result) => {
          if (live) {
            setContext(result)
            setError('')
          }
        })
        .catch((cause: unknown) => {
          if (!live) return
          if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) deny()
          else setError(cause instanceof Error ? cause.message : 'Unable to load import access.')
        })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [api, site, deny, version])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, saving])
  const available = context?.domains.some((item) => item.id === domain)
  useEffect(() => {
    if (!available) return
    let live = true
    const query = new URLSearchParams({ site, domain, after })
    void crmRead<Page>(`${api}/crm/imports?${query}`)
      .then((result) => {
        if (live) {
          setPage(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!live) return
        setPage(null)
        if ([401, 403, 404].includes(Number((cause as { status?: number }).status))) deny()
        else setError(cause instanceof Error ? cause.message : 'Unable to load imports.')
      })
    return () => {
      live = false
    }
  }, [api, site, domain, after, version, available, deny])
  const select = (id: string, nextDomain = domain) => {
    if (saving || (dirty && !window.confirm('Discard unsaved import choices?'))) return false
    const url = new URL(window.location.href)
    url.searchParams.set('site', site)
    url.searchParams.set('view', 'imports')
    url.searchParams.set('importDomain', nextDomain)
    if (id) url.searchParams.set('importID', id)
    else url.searchParams.delete('importID')
    window.history.replaceState(null, '', url.pathname + url.search)
    setSelected(id)
    setDomain(nextDomain)
    setCreating(false)
    setDirty(false)
    setError('')
    return true
  }
  if (!site) return <p>Select a chapter to manage imports.</p>
  return (
    <section aria-label="CRM imports" className="vc-crm-domain vc-crm-imports vc-crm-collection">
      <h2>Imports</h2>
      <p>
        Bring records from another platform into this chapter. Source uploads are private to the
        staff member who created the import.
      </p>
      {error && <p role="alert">{error}</p>}
      {!context && (
        <button type="button" onClick={() => setVersion((value) => value + 1)}>
          Refresh import access
        </button>
      )}
      {context && (
        <>
          <label>
            Import section
            <select
              value={domain}
              disabled={saving}
              onChange={(event) => {
                if (select('', event.target.value as ImportDomain)) {
                  setPage(null)
                  setAfter('')
                }
              }}
            >
              {!available && <option value={domain}>Choose an authorized section</option>}
              {context.domains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {available && !selected && !creating && (
            <>
              {page?.canCreate && (
                <button type="button" className="vc-crm-primary" onClick={() => setCreating(true)}>
                  Start an import
                </button>
              )}
              {page && (
                <>
                  <p>{page.total} imports in this section</p>
                  <div className="vc-crm-table-wrap">
                    <table>
                      <caption>Your imports</caption>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Source</th>
                          <th>File</th>
                          <th>State</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.docs.map((run) => (
                          <tr key={run.id}>
                            <th>{run.name}</th>
                            <td>{run.source_system}</td>
                            <td>{run.file_name}</td>
                            <td>
                              {run.stage_state} · {run.status}
                            </td>
                            <td>
                              <button type="button" onClick={() => select(run.id)}>
                                Open {run.name}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!page.docs.length && (
                    <p>
                      No imports yet. Export CSV or XLSX records from your previous platform to
                      begin.
                    </p>
                  )}
                  {after && (
                    <button
                      type="button"
                      onClick={() => {
                        setPage(null)
                        setAfter('')
                      }}
                    >
                      First imports
                    </button>
                  )}
                  {page.next && (
                    <button
                      type="button"
                      onClick={() => {
                        setPage(null)
                        setAfter(page.next!)
                      }}
                    >
                      More imports
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {(selected || creating) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (select('')) setVersion((value) => value + 1)
              }}
            >
              Back to imports
            </button>
          )}
          {available && creating && page?.canCreate && (
            <ImportSourceUpload
              api={api}
              site={site}
              domain={domain}
              onDirty={setDirty}
              onSaving={setSaving}
              onDenied={deny}
              onUploaded={(id) => {
                // The upload just completed; its dirty/saving state can clear in the same React batch.
                const url = new URL(window.location.href)
                url.searchParams.set('site', site)
                url.searchParams.set('view', 'imports')
                url.searchParams.set('importDomain', domain)
                url.searchParams.set('importID', id)
                window.history.replaceState(null, '', url.pathname + url.search)
                setSelected(id)
                setCreating(false)
                setDirty(false)
                setSaving(false)
              }}
            />
          )}
          {available && selected && (
            <ImportRunWorkspace
              api={api}
              site={site}
              id={selected}
              onDirty={setDirty}
              onSaving={setSaving}
              onDenied={deny}
            />
          )}
        </>
      )}
    </section>
  )
}
