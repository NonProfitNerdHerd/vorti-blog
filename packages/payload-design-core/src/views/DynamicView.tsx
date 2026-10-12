'use client'
/* eslint-disable @next/next/no-img-element -- Media is resolved by the application adapter. */
import { useEffect, useId, useRef, useState } from 'react'
import {
  defaultView,
  getView,
  occurrenceLanes,
  type ViewConfig,
  type ViewItem,
  type ViewResult,
} from './model'
import { eventInstant } from './schedule'
import { ContentBlock } from '../content/ContentRenderer'
import './views.css'
const eventLayouts = [
  'month',
  'week',
  'day',
  'year',
  'calendar',
  'list',
  'agenda',
  'grid',
  'tiles',
  'masonry',
  'timetable',
  'map',
  'slider',
  'carousel',
  'cover',
  'countdown',
  'widget',
  'single',
]
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const dateKey = (date: Date, zone: string) => {
  let formatter = dateFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    if (dateFormatters.size >= 64) dateFormatters.clear()
    dateFormatters.set(zone, formatter)
  }
  return formatter.format(date)
}
export function ViewThumbnail({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      {kind === 'calendar' ? (
        <>
          <rect x="3" y="4" width="58" height="32" rx="2" />
          <path d="M3 13h58M17 13v23M32 13v23M47 13v23M3 25h58" />
        </>
      ) : kind === 'list' ? (
        <>
          <path d="M22 9h39M22 15h27M22 27h39M22 33h27" />
          <rect x="3" y="7" width="13" height="10" />
          <rect x="3" y="25" width="13" height="10" />
        </>
      ) : kind === 'map' ? (
        <>
          <path d="m3 9 17-5 24 7 17-5v27l-17 4-24-7-17 5Z" />
          <circle cx="34" cy="19" r="5" />
          <path d="m30 23 4 5 4-5" />
        </>
      ) : kind === 'split' ? (
        <>
          <rect x="3" y="4" width="29" height="32" />
          <path d="M38 7h22M38 13h22M38 25h22M38 31h22" />
        </>
      ) : kind === 'slider' ? (
        <>
          <rect x="12" y="5" width="40" height="27" />
          <path d="m7 15-5 5 5 5m50-10 5 5-5 5M27 37h10" />
        </>
      ) : (
        <>
          {[3, 24, 45].map((x) => (
            <g key={x}>
              <rect x={x} y="5" width="16" height="18" />
              <path d={`M${x} 28h16M${x} 34h12`} />
            </g>
          ))}
        </>
      )}
    </svg>
  )
}
export function DynamicView({
  viewID,
  initial,
  configuration,
  editing = false,
}: {
  viewID?: string | number
  initial?: ViewResult
  configuration?: ViewConfig
  editing?: boolean
}) {
  const id = useId(),
    [result, setResult] = useState<ViewResult | undefined>(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [tag, setTag] = useState(''),
    [page, setPage] = useState(1),
    [anchor, setAnchor] = useState(() => new Date()),
    [mode, setMode] = useState('month'),
    [slide, setSlide] = useState(0),
    [selected, setSelected] = useState<ViewItem | null>(null),
    [refresh, setRefresh] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    append = useRef(false)
  const cfg = configuration || result?.config || defaultView,
    zone = cfg.timezone || 'UTC',
    layout = cfg.layout,
    calendar =
      layout.startsWith('event-') &&
      ['month', 'week', 'day', 'year', 'calendar', 'timetable'].includes(layout.slice(6))
  const activeMode =
    layout === 'event-calendar' ? mode : layout === 'event-timetable' ? 'week' : layout.slice(6)
  const localAnchor = new Date(`${dateKey(anchor, zone)}T12:00:00Z`)
  const rangeStart = new Date(
    Date.UTC(
      localAnchor.getUTCFullYear(),
      activeMode === 'year' ? 0 : localAnchor.getUTCMonth(),
      activeMode === 'year' || activeMode === 'month' ? 1 : localAnchor.getUTCDate(),
    ),
  )
  if (activeMode === 'week') rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeStart.getUTCDay())
  const rangeEnd = new Date(rangeStart)
  if (activeMode === 'year') rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 1)
  else if (activeMode === 'month') rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1)
  else rangeEnd.setUTCDate(rangeEnd.getUTCDate() + (activeMode === 'week' ? 7 : 1))
  const from = calendar
      ? new Date(eventInstant(rangeStart.toISOString().slice(0, 10), zone, false)).toISOString()
      : anchor.toISOString(),
    to = calendar
      ? new Date(eventInstant(rangeEnd.toISOString().slice(0, 10), zone, false)).toISOString()
      : new Date(anchor.getTime() + 90 * 86400000).toISOString()
  const configurationKey = configuration ? JSON.stringify(configuration) : ''
  useEffect(() => {
    // A changed central configuration or query starts a new placement result set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1)
    setSlide(0)
    append.current = false
  }, [viewID, configurationKey, search, category, tag, from, to])
  useEffect(() => {
    if (!viewID && !configurationKey) return
    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        setBusy(true)
        setError('')
        try {
          const params = new URLSearchParams({
            page: String(page),
            search,
            categories: category,
            tags: tag,
            from,
            to,
          })
          if (viewID) params.set('view', String(viewID))
          if (editing) params.set('draft', 'true')
          const response = await fetch(
            configurationKey ? '/api/content-views' : `/api/content-views?${params}`,
            {
              signal: controller.signal,
              credentials: 'same-origin',
              ...(configurationKey
                ? {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      configuration: JSON.parse(configurationKey),
                      params: Object.fromEntries(params),
                    }),
                  }
                : {}),
            },
          )
          const data = (await response.json()) as ViewResult & { error?: string }
          if (!response.ok) throw new Error(data.error || 'Unable to load content')
          setResult((previous) =>
            append.current && previous
              ? { ...data, items: [...previous.items, ...data.items] }
              : data,
          )
          append.current = false
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message)
        } finally {
          if (!controller.signal.aborted) setBusy(false)
        }
      },
      configurationKey ? 250 : 100,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [viewID, configurationKey, editing, page, search, category, tag, from, to, refresh]) // configurationKey captures the full configuration
  useEffect(() => {
    const update = () => {
      setRefresh((v) => v + 1)
      if (layout.startsWith('event-') && !calendar) setAnchor(new Date())
    }
    window.addEventListener('focus', update)
    const timer = window.setInterval(update, 60000)
    return () => {
      window.removeEventListener('focus', update)
      clearInterval(timer)
    }
  }, [layout, calendar])
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  const items = result?.items || [],
    format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
  const open = (item: ViewItem) => {
    trigger.current = document.activeElement as HTMLElement
    setSelected(item)
  }
  const close = () => {
    setSelected(null)
    trigger.current?.focus()
  }
  const categories = result?.facets?.categories || [
      ...new Map(items.flatMap((i) => i.categories || []).map((c) => [c.id, c])).values(),
    ],
    tags = result?.facets?.tags || [
      ...new Map(items.flatMap((i) => i.tags || []).map((c) => [c.id, c])).values(),
    ]
  function card(item: ViewItem, index: number) {
    return (
      <article key={item.id} className={`cv-card cv-item-${index}`}>
        {cfg.image !== false && item.image && (
          <a href={item.url} tabIndex={-1} aria-hidden="true">
            <img className="cv-image" src={item.image} alt="" loading="lazy" />
          </a>
        )}
        <div className="cv-content">
          {cfg.taxonomy !== false && !!item.categories?.length && (
            <p className="cv-taxonomy">{item.categories.map((c) => c.name).join(' · ')}</p>
          )}
          <h3 className="cv-title">
            {cfg.dialog ? (
              <button type="button" onClick={() => open(item)}>
                {item.title}
              </button>
            ) : (
              <a href={item.url}>{item.title}</a>
            )}
          </h3>
          {cfg.date !== false && (item.occurrence || item.date) && (
            <p className="cv-meta">
              <time dateTime={item.occurrence?.start || item.date}>
                {format(item.occurrence?.start || item.date!)}
              </time>
              {item.occurrence?.allDay ? ' · All day' : ''}
            </p>
          )}
          {cfg.author && item.author && <span className="cv-meta">By {item.author} </span>}
          {cfg.readingTime && <span className="cv-meta">{item.readingTime} min read</span>}
          {item.location && <p>{item.location}</p>}
          {cfg.excerpt !== false && item.excerpt && (
            <p className="cv-excerpt">
              {item.excerpt.slice(0, cfg.excerptLength || 180)}
              {item.excerpt.length > (cfg.excerptLength || 180) ? '…' : ''}
            </p>
          )}
          <a className="cv-more" href={item.url}>
            {item.occurrence ? 'Event details' : 'Read more'} <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    )
  }
  function dayCell(date: Date) {
    const key = date.toISOString().slice(0, 10),
      matching = items.filter(
        (item) =>
          item.occurrence &&
          dateKey(new Date(item.occurrence.start), zone) <= key &&
          dateKey(new Date(new Date(item.occurrence.end).getTime() - 1), zone) >= key,
      )
    return (
      <div className="cv-day" key={key}>
        <time dateTime={key}>{date.getUTCDate()}</time>
        {matching.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => open(item)}
            aria-label={`${item.title}, ${key}`}
          >
            {item.title}
          </button>
        ))}
      </div>
    )
  }
  const days = calendar ? Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) : 0
  const isSlider = /slider|carousel|ticker/.test(layout)
  const CustomRenderer = getView(layout)?.render
  const moveDate = (direction: number) => {
    const next = new Date(localAnchor)
    if (activeMode === 'year') next.setUTCFullYear(next.getUTCFullYear() + direction)
    else if (activeMode === 'month') next.setUTCMonth(next.getUTCMonth() + direction, 1)
    else next.setUTCDate(next.getUTCDate() + direction * (activeMode === 'week' ? 7 : 1))
    setAnchor(new Date(eventInstant(`${next.toISOString().slice(0, 10)}T12:00`, zone, false)))
  }
  return (
    <ContentBlock
      node={{
        id: `view-design-${id.replace(/[^\w-]/g, '')}`,
        kind: 'group',
        styles: cfg.design?.styles,
        presentation: cfg.design?.presentation,
      }}
      body={
        <section
          id={`view-${id.replaceAll(':', '')}`}
          className={`content-view cv-${layout}`}
          aria-busy={busy}
          style={
            {
              '--cv-columns': cfg.columns || 3,
              '--cv-tablet-columns': cfg.responsiveColumns?.tablet ?? 2,
              '--cv-mobile-columns': cfg.responsiveColumns?.mobile ?? 1,
              '--cv-gap': `${cfg.gap ?? 20}px`,
              '--cv-radius': `${cfg.radius ?? 6}px`,
              background: cfg.background,
              color: cfg.color,
            } as React.CSSProperties
          }
        >
          {cfg.heading && <h2>{cfg.heading}</h2>}
          {!viewID && !configuration && !initial && <p>Choose a Saved View in the inspector.</p>}
          {(cfg.search || cfg.filters) && (
            <div className="cv-controls">
              {cfg.search && (
                <label>
                  Search
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search content…"
                  />
                </label>
              )}
              {cfg.filters && (
                <>
                  <label>
                    Category
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tag
                    <select value={tag} onChange={(e) => setTag(e.target.value)}>
                      <option value="">All tags</option>
                      {tags.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          )}
          {calendar && (
            <nav className="cv-controls" aria-label="Calendar navigation">
              <button type="button" onClick={() => moveDate(-1)} aria-label="Previous period">
                ←
              </button>
              <button type="button" onClick={() => setAnchor(new Date())}>
                Today
              </button>
              <strong>
                {rangeStart.toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </strong>
              <button type="button" onClick={() => moveDate(1)} aria-label="Next period">
                →
              </button>
              {layout === 'event-calendar' && (
                <label>
                  View
                  <select
                    aria-label="Calendar view"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    {['month', 'week', 'day', 'year'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
              )}
            </nav>
          )}
          {busy && <p role="status">Loading…</p>}
          {error && (
            <p role="alert">
              {error}{' '}
              <button type="button" onClick={() => setRefresh((v) => v + 1)}>
                Retry
              </button>
            </p>
          )}
          {!busy && !error && !items.length && (
            <p>
              No matching {eventLayouts.some((l) => layout === `event-${l}`) ? 'events' : 'content'}{' '}
              found.
            </p>
          )}
          {CustomRenderer && result ? (
            <CustomRenderer result={result} onSelect={open} />
          ) : calendar ? (
            layout === 'event-timetable' || activeMode === 'week' || activeMode === 'day' ? (
              <div className="cv-timetable-scroll">
                <div className="cv-timetable" style={{ '--cv-days': days } as React.CSSProperties}>
                  <div className="cv-hours" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} style={{ top: `${h * 48}px` }}>
                        {String(h).padStart(2, '0')}:00
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: days }, (_, d) => {
                    const date = new Date(rangeStart.getTime() + d * 86400000),
                      key = date.toISOString().slice(0, 10)
                    const start = eventInstant(key, zone, false),
                      end = eventInstant(
                        new Date(date.getTime() + 86400000).toISOString().slice(0, 10),
                        zone,
                        false,
                      )
                    const matching = items.filter(
                      (item) =>
                        item.occurrence &&
                        Date.parse(item.occurrence.start) < end &&
                        Date.parse(item.occurrence.end) > start,
                    )
                    const minutes = (instant: number) => {
                      const parts = new Intl.DateTimeFormat('en', {
                        timeZone: zone,
                        hour: 'numeric',
                        minute: 'numeric',
                        hourCycle: 'h23',
                      }).formatToParts(instant)
                      return (
                        Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
                        Number(parts.find((p) => p.type === 'minute')?.value)
                      )
                    }
                    const timed = matching.filter((item) => !item.occurrence!.allDay)
                    const lanes = occurrenceLanes(timed)
                    return (
                      <section key={key} className="cv-time-day">
                        <h3>
                          {date.toLocaleDateString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </h3>
                        <div className="cv-all-day">
                          {matching
                            .filter((item) => item.occurrence!.allDay)
                            .map((item) => (
                              <button type="button" key={item.id} onClick={() => open(item)}>
                                {item.title} · All day
                              </button>
                            ))}
                        </div>
                        <div className="cv-time-track">
                          {timed.map((item) => {
                            const first = Date.parse(item.occurrence!.start),
                              last = Date.parse(item.occurrence!.end)
                            const top = first <= start ? 0 : minutes(first),
                              bottom = last >= end ? 1440 : minutes(last)
                            const placement = lanes.get(item.id)!
                            return (
                              <button
                                type="button"
                                key={item.id}
                                className="cv-time-event"
                                style={{
                                  top: `${top * 0.8}px`,
                                  height: `${Math.max(24, (bottom - top) * 0.8)}px`,
                                  left: `${(placement.lane * 100) / placement.lanes}%`,
                                  width: `${100 / placement.lanes}%`,
                                }}
                                onClick={() => open(item)}
                                aria-label={`${item.title}, ${format(item.occurrence!.start)}`}
                              >
                                <time>{format(item.occurrence!.start).split(', ').at(-1)}</time>
                                <strong>{item.title}</strong>
                              </button>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
            ) : activeMode === 'year' ? (
              <div className="cv-year">
                {Array.from({ length: 12 }, (_, m) => (
                  <section key={m}>
                    <h3>
                      {new Date(Date.UTC(localAnchor.getUTCFullYear(), m, 1)).toLocaleDateString(
                        undefined,
                        {
                          month: 'long',
                          timeZone: 'UTC',
                        },
                      )}
                    </h3>
                    <div className="cv-calendar">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <span className="cv-weekday" key={day}>
                          {day}
                        </span>
                      ))}
                      {Array.from(
                        {
                          length: new Date(
                            Date.UTC(localAnchor.getUTCFullYear(), m, 1),
                          ).getUTCDay(),
                        },
                        (_, i) => (
                          <span key={`empty-${i}`} aria-hidden="true" />
                        ),
                      )}
                      {Array.from(
                        {
                          length: new Date(
                            Date.UTC(localAnchor.getUTCFullYear(), m + 1, 0),
                          ).getUTCDate(),
                        },
                        (_, d) =>
                          dayCell(new Date(Date.UTC(localAnchor.getUTCFullYear(), m, d + 1))),
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className={`cv-calendar cv-calendar-${activeMode}`}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <span className="cv-weekday" key={day}>
                    {day}
                  </span>
                ))}
                {activeMode === 'month' &&
                  Array.from({ length: rangeStart.getUTCDay() }, (_, i) => (
                    <div key={`blank-${i}`} aria-hidden="true" />
                  ))}
                {Array.from({ length: days }, (_, d) =>
                  dayCell(new Date(rangeStart.getTime() + d * 86400000)),
                )}
              </div>
            )
          ) : layout === 'event-map' ? (
            <div className="cv-map">
              <div>
                {items.map((item, i) => (
                  <div key={item.id}>
                    <button type="button" onClick={() => setSlide(i)} aria-pressed={slide === i}>
                      {item.title}
                    </button>
                    {card(item, i)}
                  </div>
                ))}
              </div>
              {items[slide]?.latitude !== undefined && items[slide]?.longitude !== undefined ? (
                <iframe
                  title={`Map: ${items[slide].title}`}
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${items[slide].longitude! - 0.03},${items[slide].latitude! - 0.03},${items[slide].longitude! + 0.03},${items[slide].latitude! + 0.03}&layer=mapnik&marker=${items[slide].latitude},${items[slide].longitude}`}
                />
              ) : (
                <p>Select an event with map coordinates. Map data © OpenStreetMap contributors.</p>
              )}
            </div>
          ) : layout === 'taxonomy' ? (
            <>
              <div className="cv-taxonomy-grid">
                {categories.map((c) => (
                  <button type="button" key={c.id} onClick={() => setCategory(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {category && <div className="cv-items">{items.map(card)}</div>}
            </>
          ) : layout === 'event-countdown' ? (
            <>
              {items[0] && (
                <>
                  <Countdown instant={items[0].occurrence!.start} />
                  {card(items[0], 0)}
                </>
              )}
            </>
          ) : isSlider ? (
            <>
              <div className="cv-slides" aria-live="polite">
                {items
                  .slice(
                    Math.min(slide, Math.max(0, items.length - 1)),
                    Math.min(slide, Math.max(0, items.length - 1)) +
                      (layout === 'event-carousel' ? 3 : 1),
                  )
                  .map(card)}
              </div>
              <nav className="cv-controls" aria-label="Slide navigation">
                <button type="button" disabled={slide === 0} onClick={() => setSlide((s) => s - 1)}>
                  Previous
                </button>
                <span>
                  {items.length ? slide + 1 : 0} / {items.length}
                </span>
                <button
                  type="button"
                  disabled={slide >= items.length - 1}
                  onClick={() => setSlide((s) => s + 1)}
                >
                  Next
                </button>
              </nav>
            </>
          ) : (
            <div className="cv-items">
              {(layout === 'event-single' || layout === 'event-cover'
                ? items.slice(0, 1)
                : items
              ).map(card)}
            </div>
          )}
          {!calendar && result && result.totalPages > 1 && cfg.pagination !== 'none' && (
            <nav className="cv-controls" aria-label="Content pagination">
              {cfg.pagination === 'more' ? (
                <button
                  type="button"
                  disabled={busy || page >= result.totalPages}
                  onClick={() => {
                    append.current = true
                    setPage((p) => p + 1)
                  }}
                >
                  Load more
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy || page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  {cfg.pagination === 'numbers' ? (
                    Array.from(
                      { length: Math.min(7, result.totalPages) },
                      (_, i) => Math.max(1, Math.min(page - 3, result.totalPages - 6)) + i,
                    ).map((p) => (
                      <button
                        type="button"
                        key={p}
                        aria-current={p === page ? 'page' : undefined}
                        disabled={busy}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ))
                  ) : (
                    <span>
                      Page {page} of {result.totalPages}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy || page >= result.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </>
              )}
            </nav>
          )}
          <dialog
            ref={dialog}
            className="cv-dialog"
            onCancel={(e) => {
              e.preventDefault()
              close()
            }}
            onClick={(e) => {
              if (e.target === dialog.current) close()
            }}
          >
            {selected && (
              <>
                <button type="button" onClick={close} autoFocus aria-label="Close event details">
                  ×
                </button>
                <h2>{selected.title}</h2>
                {selected.occurrence && (
                  <p>
                    {format(selected.occurrence.start)} – {format(selected.occurrence.end)} (
                    {selected.occurrence.timezone})
                  </p>
                )}
                <p>{selected.location}</p>
                <p>{selected.excerpt}</p>
                <a href={selected.url}>Open full page</a>
              </>
            )}
          </dialog>
        </section>
      }
    />
  )
}
function Countdown({ instant }: { instant: string }) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((Date.parse(instant) - now) / 1000))
  return (
    <p className="cv-countdown" role="timer" aria-label="Time until event">
      {!now
        ? 'Loading countdown…'
        : seconds
          ? `${Math.floor(seconds / 86400)} days ${Math.floor((seconds % 86400) / 3600)} hours ${Math.floor((seconds % 3600) / 60)} minutes ${seconds % 60} seconds`
          : 'This event has started.'}
    </p>
  )
}
