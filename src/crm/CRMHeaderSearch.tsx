'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useConfig } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { redirectToLogin } from '../components/auth-return'
import { searchResultURL, searchSections, type CRMSearchPage } from './search-ui'
import './search.css'

export function CRMHeaderSearch() {
  const path = usePathname()
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CRMSearchPage | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLFormElement>(null)
  const site = binding?.site.id || ''
  const active = path.replace(/\/$/, '') === `${config.routes.admin}/crm`
  useEffect(() => {
    if (!active || !site || query.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const p = new URLSearchParams({ site, q: query.trim(), mode: 'suggest' })
        const response = await fetch(`${config.routes.api}/crm/search?${p}`, { cache: 'no-store', signal: controller.signal })
        if (response.status === 401) redirectToLogin(config.routes.admin, '/login')
        if (!response.ok) throw new Error('Search is unavailable. Try again.')
        setResults(await response.json() as CRMSearchPage)
        setError('')
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message)
      }
    }, 220)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [active, config.routes.admin, config.routes.api, query, site])
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [])
  if (!active || !site) return null
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before opening a search result?')) event.preventDefault()
    else setOpen(false)
  }
  return <form ref={root} className="vc-header-search" role="search" onSubmit={event => {
    event.preventDefault()
    if (query.trim().length < 2) return
    if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before searching?')) return
    // A document navigation retains the existing beforeunload guard for unsaved CRM drafts.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${config.routes.admin}/crm?${new URLSearchParams({ view: 'search', site, q: query.trim() })}`)
  }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); (event.target as HTMLElement).blur() } }}>
    <label className="vc-header-search__label" htmlFor="vc-global-crm-search">Search VortiCause</label>
    <span className="vc-header-search__field"><span aria-hidden="true">⌕</span><input id="vc-global-crm-search" type="search" value={query}
      placeholder="Search VortiCause" autoComplete="off" onFocus={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setOpen(true); setResults(null) }} /></span>
    {open && query.trim().length >= 2 && <div className="vc-header-search__suggestions" role="region" aria-label="Search suggestions">
      {error && <p role="alert">{error}</p>}
      {!error && !results && <p role="status">Searching…</p>}
      {results && !results.docs.length && <p>No matching records.</p>}
      {results && searchSections.filter(([section]) => section !== 'all' && results.docs.some(item => item.section === section)).map(([section, label]) =>
        <div key={section} className="vc-header-search__group"><h3>{label}</h3>{results.docs.filter(item => item.section === section).map((item, index) =>
          <Link key={`${item.subtype}:${item.id}:${index}`} href={searchResultURL(config.routes.admin, site, item)} onClick={navigate}>
            <span>{item.label}</span><small>{item.subtype}{item.detail ? ` · ${item.detail}` : ''}</small>
          </Link>)}</div>)}
      <button type="submit">View all results for “{query.trim()}”</button>
    </div>}
  </form>
}
