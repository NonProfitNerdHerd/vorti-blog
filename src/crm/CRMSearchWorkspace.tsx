'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { searchResultURL, searchSections, type CRMSearchPage } from './search-ui'
import { redirectToLogin } from '../components/auth-return'
export function CRMSearchWorkspace({ api, admin, site }: { api: string; admin: string; site: string }) {
  const params = useSearchParams()
  const query = params.get('q') || ''
  const selected = params.get('section') || 'all'
  const page = Math.max(1, Number(params.get('page') || 1) || 1)
  const [data, setData] = useState<CRMSearchPage | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (query.trim().length < 2 || !site) return
    const controller = new AbortController()
    fetch(`${api}/crm/search?${new URLSearchParams({ site, q: query, section: selected, page: String(page) })}`,
      { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 401) redirectToLogin(admin, '/login')
      if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message || 'Search failed.')
      return response.json() as Promise<CRMSearchPage>
    }).then(value => { if (!controller.signal.aborted) { setData(value); setError('') } })
      .catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message) })
    return () => controller.abort()
  }, [admin, api, site, query, selected, page])
  const url = (section: string, nextPage = 1) => `${admin}/crm?${new URLSearchParams({ view: 'search', site, q: query, section, page: String(nextPage) })}`
  return <section className="vc-crm-domain vc-crm-collection vc-crm-search-results" aria-label="CRM search results">
    <h1>Search results</h1><p>Results for “{query}” in the selected site.</p>
    <nav aria-label="Result sections" className="vc-crm-toolbar">{searchSections.map(([value, label]) =>
      <Link key={value} href={url(value)} aria-current={selected === value ? 'page' : undefined}>{label}</Link>)}</nav>
    {query.trim().length < 2 && <p>Enter at least two characters to search.</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && query.trim().length >= 2 && <p role="status">Searching…</p>}
    {data && <><p>{data.total} matching records</p><div className="vc-crm-table"><table><thead><tr><th>Record</th><th>Section</th><th>Details</th></tr></thead>
      <tbody>{data.docs.map((item, index) => <tr key={`${item.section}:${item.subtype}:${item.id}:${index}`}><td><Link href={searchResultURL(admin, site, item)}>{item.label}</Link></td>
        <td>{item.section} · {item.subtype}</td><td>{item.detail || '—'}</td></tr>)}
        {!data.docs.length && <tr><td colSpan={3}>No records match this search.</td></tr>}</tbody></table></div>
      <div className="vc-crm-pagination">{page <= 1 ? <span aria-disabled="true">Previous</span> : <Link href={url(selected, page - 1)}>Previous</Link>}
        <span>Page {page}</span>{page * 25 >= data.total ? <span aria-disabled="true">Next</span> : <Link href={url(selected, page + 1)}>Next</Link>}</div></>}
  </section>
}
