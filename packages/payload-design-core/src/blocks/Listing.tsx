'use client'
/* eslint-disable @next/next/no-img-element -- Media URLs are already resolved by the host application. */
import { useEffect, useState } from 'react'
import { safeURL, type ContentNode } from '../content/model'
import type { ListingResult } from './resolve'
const emptyProps: Record<string, unknown> = {}
export default function Listing({ node, editing }: { node: ContentNode; editing?: boolean }) {
  const props = node.props ?? emptyProps
  const [result, setResult] = useState<ListingResult>({
    results: Array.isArray(props.results) ? (props.results as ListingResult['results']) : [],
    page: Number(props.page ?? 1),
    totalPages: Number(props.totalPages ?? 1),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries(props)
        .filter(([key]) => ['collection', 'limit', 'sort', 'ids', 'categories'].includes(key))
        .map(([key, value]) => [key, String(value)]),
    ),
  ).toString()
  useEffect(() => {
    if (!editing) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/block-listing?${query}&draft=true`, {
          signal: controller.signal,
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error('Unable to load the listing preview.')
        setResult((await response.json()) as ListingResult)
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [editing, query])
  useEffect(() => {
    const element = document.getElementById(`listing-${node.id}`)
    if (!element) return
    let controller: AbortController | undefined
    const load = async (event: Event) => {
      const detail = (event as CustomEvent<{ direction: number; append: boolean }>).detail
      const next = result.page + detail.direction
      if (next < 1 || next > result.totalPages) return
      controller?.abort()
      controller = new AbortController()
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams(
          Object.fromEntries(
            Object.entries(props)
              .filter(([key]) =>
                ['collection', 'limit', 'sort', 'ids', 'categories', 'draft'].includes(key),
              )
              .map(([key, value]) => [key, String(value)]),
          ),
        )
        params.set('page', String(next))
        if (editing) params.set('draft', 'true')
        const response = await fetch(`/api/block-listing?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unable to load content. Please try again.')
        const data = (await response.json()) as ListingResult
        setResult({
          ...data,
          results: detail.append ? [...result.results, ...data.results] : data.results,
        })
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setError((error as Error).message)
      } finally {
        setLoading(false)
      }
    }
    element.addEventListener('listing-page', load)
    return () => {
      controller?.abort()
      element.removeEventListener('listing-page', load)
    }
  }, [node.id, props, result, editing])
  return (
    <section
      id={`listing-${node.id}`}
      aria-label="Content listing"
      aria-busy={loading}
      data-listing-page={result.page}
      data-listing-pages={result.totalPages}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            props.presentation === 'list' || node.variation?.id === 'list'
              ? '1fr'
              : 'repeat(auto-fit,minmax(220px,1fr))',
          gap: '1rem',
        }}
      >
        {result.results.map((item, index) => (
          <article className="listing-item" key={`${item.url}-${index}`}>
            {props.showImage !== false && item.image && (
              <img
                className="listing-image"
                src={safeURL(item.image)}
                alt=""
                style={{ maxWidth: '100%' }}
              />
            )}
            {props.showTitle !== false && <h3 className="listing-title">{item.title}</h3>}
            {props.showExcerpt !== false && <p className="listing-excerpt">{item.excerpt}</p>}
            {props.showDate !== false && item.publishedAt && (
              <time className="listing-meta" dateTime={item.publishedAt}>
                {item.publishedAt.slice(0, 10)}
              </time>
            )}
            {props.showTaxonomy !== false && <p className="listing-meta">{item.taxonomy}</p>}
            {props.showLink !== false && (
              <a
                className="listing-link"
                href={safeURL(item.url)}
                onClick={editing ? (event) => event.preventDefault() : undefined}
              >
                Read more
              </a>
            )}
          </article>
        ))}
      </div>
      <p role="status">
        {loading
          ? 'Loading content…'
          : !result.results.length
            ? editing
              ? 'No matching content. Choose documents or adjust the listing filters.'
              : 'No matching content.'
            : `Page ${result.page} of ${result.totalPages}`}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
export function ListingNavigation({ node }: { node: ContentNode; editing?: boolean }) {
  const [status, setStatus] = useState('')
  const move = (direction: number) => {
    const listing = document.getElementById(`listing-${node.props?.listingID}`)
    if (!listing) {
      setStatus('The linked listing is unavailable.')
      return
    }
    const page = Number(listing.dataset.listingPage),
      pages = Number(listing.dataset.listingPages)
    if (page + direction < 1 || page + direction > pages) {
      setStatus(direction > 0 ? 'No more content.' : 'Already at the first page.')
      return
    }
    listing.dispatchEvent(
      new CustomEvent('listing-page', { detail: { direction, append: node.kind === 'loadMore' } }),
    )
    setStatus('')
  }
  return (
    <nav aria-label="Listing pagination">
      {node.kind === 'pagination' && (
        <button type="button" onClick={() => move(-1)}>
          Previous
        </button>
      )}
      <button type="button" onClick={() => move(1)}>
        {node.kind === 'loadMore' ? String(node.props?.label ?? 'Load more') : 'Next'}
      </button>
      <span role="status">{status}</span>
    </nav>
  )
}
