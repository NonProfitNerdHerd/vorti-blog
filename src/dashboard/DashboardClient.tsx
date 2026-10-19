'use client'
import { loadPersonalTasks } from '@/review/personal-tasks'
import { userIdentity } from '@design-system/payload-design-core/content'
/* eslint-disable react-hooks/set-state-in-effect -- Each request lifecycle synchronizes loading and remote result state. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth, useConfig } from '@payloadcms/ui'
import type { Where } from 'payload'
import { Tasks } from '../review/Tasks'
import { query, reviewAPI, statuses, type Task } from '../review/client'
import { localTaskDay, taskFiltersWhere, taskPresetFilters } from '../review/dashboard-model'
import '../review/tasks.css'
import './dashboard.css'

type Content = {
  id: number
  title: string
  _status?: string
  _displayStatus?: string
  updatedAt: string
  collection: 'posts' | 'pages'
}
type Page<T> = { docs: T[] }

/** Each widget owns its request lifecycle and can fail or retry independently. */
function useWidget<T>(load: () => Promise<T>, refresh: number) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setState((old) => ({ ...old, error: undefined, loading: true }))
    void load().then(
      (data) => {
        if (current) setState({ data, loading: false })
      },
      () => {
        if (current)
          setState({ error: 'Could not load this widget. Please try again.', loading: false })
      },
    )
    return () => {
      current = false
    }
  }, [load, refresh, retry])
  return { ...state, retry: () => setRetry((value) => value + 1) }
}
function State({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  if (error)
    return (
      <p role="alert">
        {error}{' '}
        <button type="button" onClick={retry}>
          Retry
        </button>
      </p>
    )
  return loading ? (
    <p role="status" className="vp-dashboard__muted">
      Loading…
    </p>
  ) : null
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`vp-dashboard__badge vp-dashboard__badge--${value}`}>
      {statuses[value as keyof typeof statuses] ||
        (value === 'published' ? 'Published' : value === 'changed' ? 'Changed' : 'Draft')}
    </span>
  )
}
function taskLink(admin: string, due = '') {
  return `${admin}/collections/review-tasks?${new URLSearchParams({ taskView: 'assigned', ...(due ? { due } : {}), page: '1', limit: '10' })}`
}
function SummaryTile({
  api,
  collection,
  label,
  where,
  href,
  refresh,
  icon,
}: {
  api: string
  collection: string
  label: string
  where: Where
  href: string
  refresh: number
  icon: string
}) {
  const load = useCallback(
    () =>
      reviewAPI<{ totalDocs: number }>(
        api,
        `${collection}/count?${new URLSearchParams({ where: JSON.stringify(where) })}`,
      ),
    [api, collection, where],
  )
  const widget = useWidget(load, refresh)
  return (
    <article className="vp-dashboard__tile">
      <Link href={href}>
        <span className="vp-dashboard__tile-label">
          <span aria-hidden="true">{icon}</span>
          {label}
        </span>
        <strong>{widget.loading ? '…' : (widget.data?.totalDocs?.toLocaleString() ?? '—')}</strong>
      </Link>
      {widget.error && <button onClick={widget.retry}>Retry count</button>}
    </article>
  )
}
function DraftTile({
  api,
  collections,
  admin,
  refresh,
}: {
  api: string
  collections: string[]
  admin: string
  refresh: number
}) {
  const load = useCallback(async () => {
    const values = await Promise.all(
      ['posts', 'pages']
        .filter((slug) => collections.includes(slug))
        .map((slug) =>
          reviewAPI<{ totalDocs: number }>(api, `${slug}/count?where[_status][equals]=draft`),
        ),
    )
    return values.reduce((sum, value) => sum + value.totalDocs, 0)
  }, [api, collections])
  const widget = useWidget(load, refresh)
  return (
    <article className="vp-dashboard__tile">
      <span className="vp-dashboard__tile-label">
        <span aria-hidden="true">✎</span>Draft documents
      </span>
      <strong>{widget.loading ? '…' : (widget.data?.toLocaleString() ?? '—')}</strong>
      <div className="vp-dashboard__tile-links">
        {['posts', 'pages']
          .filter((slug) => collections.includes(slug))
          .map((slug) => (
            <Link key={slug} href={`${admin}/collections/${slug}?where[_status][equals]=draft`}>
              {slug === 'posts' ? 'Posts' : 'Pages'}
            </Link>
          ))}
      </div>
      {widget.error && <button onClick={widget.retry}>Retry count</button>}
    </article>
  )
}
function RecentContent({
  api,
  admin,
  collections,
  refresh,
}: {
  api: string
  admin: string
  collections: string[]
  refresh: number
}) {
  const [tab, setTab] = useState('all')
  const load = useCallback(async () => {
    const lists = await Promise.all(
      (['posts', 'pages'] as const)
        .filter((slug) => collections.includes(slug) && (tab === 'all' || tab === slug))
        .map(async (collection) => {
          const result = await reviewAPI<Page<Omit<Content, 'collection'>>>(
            api,
            `${collection}?${query({}, { limit: '6', draft: 'true', 'select[title]': 'true', 'select[_status]': 'true', 'select[updatedAt]': 'true' })}`,
          )
          // Like Payload's list, distinguish an unpublished draft from changes to a published record.
          const drafts = result.docs.filter((doc) => doc._status === 'draft').map((doc) => doc.id)
          const published = new Set<number>()
          if (drafts.length) {
            try {
              const versions = await reviewAPI<Page<{ parent: number }>>(
                api,
                `${collection}/versions?${query({ and: [{ parent: { in: drafts } }, { 'version._status': { equals: 'published' } }] }, { limit: '0', 'select[parent]': 'true' })}`,
              )
              for (const version of versions.docs) published.add(version.parent)
            } catch {
              /* As in the native list, retain the draft status if versions are unavailable. */
            }
          }
          return result.docs.map((doc) => ({
            ...doc,
            collection,
            _displayStatus:
              doc._status === 'draft' && published.has(doc.id) ? 'changed' : doc._status,
          }))
        }),
    )
    return lists
      .flat()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .slice(0, 6)
  }, [api, collections, tab])
  const widget = useWidget(load, refresh)
  return (
    <section className="vp-dashboard__panel" aria-labelledby="recent-heading">
      <div className="vp-dashboard__panel-heading">
        <h2 id="recent-heading">Recently updated content</h2>
        <div className="vp-dashboard__tabs" aria-label="Content type">
          {['all', 'posts', 'pages']
            .filter((value) => value === 'all' || collections.includes(value))
            .map((value) => (
              <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
                {value === 'all' ? 'All' : value === 'posts' ? 'Posts' : 'Pages'}
              </button>
            ))}
        </div>
      </div>
      <State {...widget} />
      {!widget.loading && !widget.error && (
        <>
          {!widget.data?.length && <p className="vp-dashboard__muted">No content yet.</p>}
          <ul className="vp-dashboard__rows">
            {widget.data?.map((doc) => (
              <li key={`${doc.collection}-${doc.id}`}>
                <div>
                  <Link
                    className="vp-dashboard__title"
                    href={`${admin}/collections/${doc.collection}/${doc.id}`}
                  >
                    {doc.title || 'Untitled'}
                  </Link>
                  <small>
                    {doc.collection === 'posts' ? 'Post' : 'Page'} ·{' '}
                    <time dateTime={doc.updatedAt}>{new Date(doc.updatedAt).toLocaleString()}</time>
                  </small>
                </div>
                <Badge value={doc._displayStatus || doc._status || 'draft'} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="vp-dashboard__footer-links">
        {['posts', 'pages']
          .filter((slug) => collections.includes(slug))
          .map((slug) => (
            <Link key={slug} href={`${admin}/collections/${slug}`}>
              All {slug} →
            </Link>
          ))}
      </div>
    </section>
  )
}
function MyTasks({
  api,
  admin,
  userID,
  refresh,
  onSelect,
}: {
  api: string
  admin: string
  userID: string
  refresh: number
  onSelect: (task: Task) => void
}) {
  const [today, setToday] = useState(localTaskDay)
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localTaskDay()), 60000)
    return () => clearInterval(timer)
  }, [])
  const load = useCallback(() => loadPersonalTasks(api, userID, today), [api, userID, today])
  const widget = useWidget(load, refresh)
  return (
    <section className="vp-dashboard__panel" aria-labelledby="my-tasks-heading">
      <div className="vp-dashboard__panel-heading">
        <h2 id="my-tasks-heading">My tasks</h2>
        <Link href={taskLink(admin)}>View all →</Link>
      </div>
      <State {...widget} />
      {!widget.loading && !widget.error && (
        <>
          <div className="vp-dashboard__task-counts">
            {['Unfinished', 'Overdue', 'Due soon'].map((label, index) => (
              <Link key={label} href={taskLink(admin, ['', 'overdue', 'soon'][index])}>
                <strong>{widget.data?.counts[index] ?? 0}</strong>
                {label}
              </Link>
            ))}
          </div>
          {!widget.data?.docs.length && (
            <p className="vp-dashboard__muted">
              You’re all caught up. No unfinished tasks assigned to you.
            </p>
          )}
          <ul className="vp-dashboard__rows">
            {widget.data?.docs.map((task) => (
              <li key={task.id}>
                <div>
                  <button
                    type="button"
                    className="vp-dashboard__title"
                    onClick={() => onSelect(task)}
                  >
                    {task.title}
                  </button>
                  <small
                    className={
                      task.dueDate && task.dueDate.slice(0, 10) < today
                        ? 'vp-dashboard__overdue'
                        : ''
                    }
                  >
                    {task.dueDate
                      ? `Due ${new Date(`${task.dueDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC' })}`
                      : 'No due date'}
                    {task.documentTitle ? ` · ${task.documentTitle}` : ''}
                  </small>
                </div>
                <Badge value={task.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
const published: Where = { _status: { equals: 'published' } }
export function DashboardClient({ collections }: { collections: string[] }) {
  const {
    config: {
      routes: { api, admin },
    },
  } = useConfig()
  const { user, permissions } = useAuth()
  const [refresh, setRefresh] = useState(0)
  const refreshAll = useCallback(async () => {
    setRefresh((value) => value + 1)
  }, [])
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState !== 'hidden') void refreshAll()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [refreshAll])
  const userID = String(user?.id ?? '')
  const taskWhere = useMemo(
    () => taskFiltersWhere(taskPresetFilters('assigned', userID), localTaskDay()),
    [userID],
  )
  const name = userIdentity(
    user,
    typeof user?.displayName === 'string' ? user.displayName.split(' ')[0] : '',
  )
  return (
    <main className="vp-dashboard">
      <header className="vp-dashboard__heading">
        <div>
          <p>Your workspace</p>
          <h1>{name ? `Welcome back, ${name}` : 'Welcome back'}</h1>
          <span className="vp-dashboard__muted">A clear view of your site and what’s next.</span>
        </div>
        <div className="vp-dashboard__actions">
          <button type="button" onClick={() => void refreshAll()} aria-label="Refresh Dashboard">
            ↻ Refresh
          </button>
          {(['posts', 'pages'] as const)
            .filter(
              (slug) => collections.includes(slug) && permissions?.collections?.[slug]?.create,
            )
            .map((slug) => (
              <Link
                className="vp-dashboard__primary"
                key={slug}
                href={`${admin}/collections/${slug}/create`}
              >
                + New {slug === 'posts' ? 'post' : 'page'}
              </Link>
            ))}
        </div>
      </header>
      <div className="vp-dashboard__summary">
        {['posts', 'pages']
          .filter((slug) => collections.includes(slug))
          .map((slug) => (
            <SummaryTile
              key={slug}
              api={api}
              collection={slug}
              label={`Published ${slug}`}
              where={published}
              href={`${admin}/collections/${slug}?where[_status][equals]=published`}
              refresh={refresh}
              icon={slug === 'posts' ? '▤' : '▧'}
            />
          ))}
        <DraftTile api={api} collections={collections} admin={admin} refresh={refresh} />
        {collections.includes('review-tasks') && (
          <SummaryTile
            api={api}
            collection="review-tasks"
            label="My unfinished tasks"
            where={taskWhere}
            href={taskLink(admin)}
            refresh={refresh}
            icon="☑"
          />
        )}
      </div>
      <div className="vp-dashboard__columns">
        <RecentContent api={api} admin={admin} collections={collections} refresh={refresh} />
        {collections.includes('review-tasks') && (
          <Tasks
            onChange={refreshAll}
            renderList={({ onSelect, refreshKey }) => (
              <MyTasks
                api={api}
                admin={admin}
                userID={userID}
                refresh={refresh + refreshKey}
                onSelect={onSelect}
              />
            )}
          />
        )}
      </div>
    </main>
  )
}
