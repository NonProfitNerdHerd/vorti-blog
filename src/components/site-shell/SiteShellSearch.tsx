'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SiteAnchor, usePublicFetch } from '@design-system/payload-design-core/content'

interface Result { title: string; url: string }
export function SiteShellSearch({ label = 'Search', placeholder = 'Search content' }: { label?: string; placeholder?: string }) {
  const request = usePublicFetch(), pending = useRef<AbortController | null>(null)
  const [query, setQuery] = useState(''), [results, setResults] = useState<Result[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => () => pending.current?.abort(), [])
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); pending.current?.abort()
    const term = query.trim().slice(0, 200)
    if (!term) { setResults(null); setError(''); setBusy(false); return }
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setResults(null)
    try {
      const responses = await Promise.all(['posts', 'pages'].map(async collection => {
        const params = new URLSearchParams({ collection, q: term, limit: '10', sort: 'title' })
        const response = await request(`/api/block-listing?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), cache: 'no-store' })
        if ([403, 404].includes(response.status)) return []
        if (!response.ok) throw Error('Search could not finish. Try again.')
        return (await response.json() as { results: Result[] }).results
      }))
      if (!controller.signal.aborted) setResults(responses.flat())
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search is unavailable. Try again.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section className="site-shell-search" aria-label={label}><form role="search" onSubmit={event => void search(event)} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
    <label><span className="visually-hidden">{label}</span><input type="search" placeholder={placeholder} value={query} maxLength={200} onChange={event => { pending.current?.abort(); setBusy(false); setResults(null); setError(''); setQuery(event.target.value) }} /></label>
    <button type="submit" disabled={busy}>{busy ? 'Searching…' : label}</button>
  </form>{error && <p role="alert">{error}</p>}{results && <div aria-live="polite"><p>{results.length ? 'Matching content' : 'No matching content is available.'}</p><ul>{results.map(result => <li key={result.url}><SiteAnchor href={result.url}>{result.title}</SiteAnchor></li>)}</ul></div>}</section>
}
