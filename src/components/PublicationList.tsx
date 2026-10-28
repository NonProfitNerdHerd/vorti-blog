'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize publication results with URL and native list filters. */
import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useConfig, useListQuery } from '@payloadcms/ui'
import { PublishingAreaList } from '../publishing/PublishingAreaList'
import { CalendarDays, ChartNoAxesGantt, ChevronLeft, ChevronRight, List } from './ContentIcons'
import type { ListViewClientProps, Where } from 'payload'
import {
  publicationDate,
  publicationDay,
  publicationDays,
  publicationPeriod,
  shiftPublicationDate,
  type PublicationMode,
} from './publication-model'
import './publication-views.css'

type Publication = {
  id: number | string
  title: string
  publishedAt?: string | null
  _status?: string
}
export function PublicationList(props: ListViewClientProps) {
  const [hydrated, setHydrated] = useState(false)
  const [navigating, startTransition] = useTransition()
  useEffect(() => setHydrated(true), [])
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view =
    params.get('contentView') === 'calendar'
      ? 'calendar'
      : params.get('contentView') === 'gantt'
        ? 'gantt'
        : 'list'
  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    startTransition(() => router.push(`${pathname}?${next}`, { scroll: false }))
  }
  const tabs = (
    <nav className="publication-tabs" aria-label="Content views">
      {(
        [
          ['list', 'List', List],
          ['calendar', 'Calendar', CalendarDays],
          ['gantt', 'Gantt', ChartNoAxesGantt],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          disabled={navigating}
          aria-current={view === value ? 'page' : undefined}
          onClick={() => change({ contentView: value === 'list' ? '' : value })}
        >
          <Icon size={17} />
          {label}
        </button>
      ))}
    </nav>
  )
  return (
    <div className="publication-workspace" data-content-view={view}>
      <PublishingAreaList
        {...props}
        BeforeListTable={
          <>
            {props.BeforeListTable}
            {tabs}
            {view !== 'list' && hydrated && (
              <PublicationSchedule collection={props.collectionSlug} view={view} change={change} navigating={navigating} />
            )}
            {view !== 'list' && !hydrated && <p role="status">Loading publication view…</p>}
          </>
        }
      />
    </div>
  )
}
function PublicationSchedule({
  collection,
  view,
  change,
  navigating,
}: {
  collection: string
  view: 'calendar' | 'gantt'
  change: (values: Record<string, string>) => void
  navigating: boolean
}) {
  const params = useSearchParams()
  const { query } = useListQuery()
  const {
    config: {
      routes: { api, admin },
    },
  } = useConfig()
  const mode: PublicationMode =
    view === 'gantt'
      ? 'month'
      : params.get('calendarMode') === 'week'
        ? 'week'
        : params.get('calendarMode') === 'day'
          ? 'day'
          : 'month'
  const date = publicationDate(params.get('calendarDate'))
  const { start, end } = publicationPeriod(date, mode)
  const [records, setRecords] = useState<Publication[]>([])
  const [undated, setUndated] = useState<{
    docs: Publication[]
    totalDocs: number
    totalPages: number
  }>({ docs: [], totalDocs: 0, totalPages: 1 })
  const [undatedPage, setUndatedPage] = useState(1)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const filter = JSON.stringify({ where: query.where, search: query.search })
  const from = start.toISOString(),
    to = end.toISOString()
  useEffect(() => {
    setUndatedPage(1)
  }, [filter])
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setError('')
    const native = JSON.parse(filter)
    const base: Where[] = native.where ? [native.where] : []
    if (native.search) base.push({ title: { contains: native.search } })
    async function load() {
      async function get(where: Where, page: number, limit: number) {
        const qs = new URLSearchParams({
          where: JSON.stringify({ and: [...base, where] }),
          depth: '0',
          draft: 'true',
          sort: 'publishedAt,title',
          limit: String(limit),
          page: String(page),
        })
        const response = await fetch(`${api}/${collection}?${qs}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error('Unable to load publications. Your filters are preserved.')
        return response.json() as Promise<{
          docs: Publication[]
          totalDocs: number
          totalPages: number
        }>
      }
      const dated = async () => {
        const where = { publishedAt: { greater_than_equal: from, less_than: to } }
        const first = await get(where, 1, 100)
        const docs = [...first.docs]
        for (let page = 2; page <= first.totalPages; page++)
          docs.push(...(await get(where, page, 100)).docs)
        return docs
      }
      const [docs, missing] = await Promise.all([
        dated(),
        get(
          { or: [{ publishedAt: { exists: false } }, { publishedAt: { equals: null } }] },
          undatedPage,
          10,
        ),
      ])
      if (!controller.signal.aborted) {
        setRecords(docs)
        setUndated(missing)
      }
    }
    void load()
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [api, collection, filter, from, to, undatedPage, revision])
  const title =
    mode === 'day'
      ? start.toLocaleDateString(undefined, { dateStyle: 'full' })
      : mode === 'week'
        ? `${start.toLocaleDateString()} – ${new Date(end.getTime() - 1).toLocaleDateString()}`
        : start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const days = publicationDays(start, end)
  const editor = (doc: Publication) => `${admin}/collections/${collection}/${doc.id}`
  const item = (doc: Publication) => (
    <Link key={doc.id} href={editor(doc)} className="publication-event">
      <strong>{doc.title || 'Untitled'}</strong>
      <span>
        {doc._status === 'published' ? 'Published' : 'Draft'} ·{' '}
        {new Date(doc.publishedAt!).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>
    </Link>
  )
  return (
    <section
      className="publication-schedule"
      aria-label={view === 'gantt' ? 'Publication Gantt' : 'Publication calendar'}
      aria-busy={busy}
    >
      <div className="publication-period">
        <div>
          <button
            type="button"
            aria-label="Previous period"
            disabled={navigating}
            onClick={() =>
              change({ calendarDate: publicationDay(shiftPublicationDate(date, mode, -1)) })
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => change({ calendarDate: publicationDay(new Date()) })}
            disabled={navigating}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next period"
            disabled={navigating}
            onClick={() =>
              change({ calendarDate: publicationDay(shiftPublicationDate(date, mode, 1)) })
            }
          >
            <ChevronRight size={18} />
          </button>
          <h2>{title}</h2>
        </div>
        {view === 'calendar' && (
          <div role="group" aria-label="Calendar period">
            {(['day', 'week', 'month'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={navigating}
                onClick={() => change({ calendarMode: value })}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="publication-caption">
        Publication dates · {Intl.DateTimeFormat().resolvedOptions().timeZone}. Drafts with a date
        are labeled.
      </p>
      {busy && <p role="status">Loading publications…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRevision((current) => current + 1)}>
            Retry
          </button>
        </p>
      )}
      {!busy && !error && (
        <>
          {view === 'gantt' ? (
            <>
              <p className="publication-caption">
                Each diamond marks a publication date; content has no scheduled duration.
              </p>
              <div className="publication-gantt">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      {days.map((day) => (
                        <th key={publicationDay(day)}>{day.getDate()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((doc) => (
                      <tr key={doc.id}>
                        <th>
                          <Link href={editor(doc)}>{doc.title}</Link>
                        </th>
                        {days.map((day) => (
                          <td key={publicationDay(day)}>
                            {publicationDay(new Date(doc.publishedAt!)) === publicationDay(day) && (
                              <Link
                                aria-label={`${doc.title}: ${new Date(doc.publishedAt!).toLocaleString()}`}
                                href={editor(doc)}
                              >
                                ◆
                              </Link>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="publication-calendar" data-mode={mode}>
              {mode !== 'day' &&
                ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div className="publication-weekday" key={day}>
                    {day}
                  </div>
                ))}
              {mode === 'month' &&
                Array.from({ length: (start.getDay() + 6) % 7 }, (_, index) => (
                  <div
                    key={`empty-${index}`}
                    className="publication-date publication-date--empty"
                  />
                ))}
              {days.map((day) => (
                <div
                  key={publicationDay(day)}
                  className="publication-date"
                  data-today={publicationDay(day) === publicationDay(new Date())}
                >
                  <time dateTime={publicationDay(day)}>{day.getDate()}</time>
                  {records
                    .filter(
                      (doc) => publicationDay(new Date(doc.publishedAt!)) === publicationDay(day),
                    )
                    .map(item)}
                </div>
              ))}
            </div>
          )}
          {records.length === 0 && <p>No dated publications in this period match your filters.</p>}
          <div className="publication-undated-heading">
            <h3>No publication date ({undated.totalDocs})</h3>
            <div>
              <button
                type="button"
                aria-label="Previous undated page"
                disabled={undatedPage <= 1}
                onClick={() => setUndatedPage((page) => page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                Page {undatedPage} of {Math.max(1, undated.totalPages)}
              </span>
              <button
                type="button"
                aria-label="Next undated page"
                disabled={undatedPage >= undated.totalPages}
                onClick={() => setUndatedPage((page) => page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <table className="publication-undated">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {undated.docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <Link href={editor(doc)}>{doc.title}</Link>
                  </td>
                  <td>{doc._status === 'published' ? 'Published' : 'Draft'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!undated.totalDocs && <p>No undated content matches your filters.</p>}
        </>
      )}
    </section>
  )
}
