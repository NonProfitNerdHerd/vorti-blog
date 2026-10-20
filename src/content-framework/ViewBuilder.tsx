'use client'
import { useEffect, useState } from 'react'
import { useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import {
  defaultView,
  listViews,
  DynamicView,
  ViewThumbnail,
  type ViewConfig,
  type QueryRule,
} from '@design-system/payload-design-core/content'
import './framework.css'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { ViewDesignEditor, BackgroundMediaPicker } from '@design-system/payload-design-core/admin'
export function RelationPicker({
  label,
  collection,
  value,
  onChange,
  single = false,
  disabled = false,
}: {
  label: string
  collection: string
  value: string[]
  onChange: (ids: string[]) => void
  single?: boolean
  disabled?: boolean
}) {
  const available = useCategoriesEnabled() || collection !== 'categories'
  const [search, setSearch] = useState(''),
    [items, setItems] = useState<
      Array<{
        id: string | number
        title?: string
        name?: string
        singular?: string
        filename?: string
        attributionPreference?: 'username' | 'email' | null
        attributionLabel?: string
        displayName?: string
        email?: string
      }>
    >([])
  useEffect(() => {
    if (!available) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const field = ['categories', 'tags', 'saved-views'].includes(collection)
        ? 'name'
        : collection === 'design-templates'
          ? 'name'
          : collection === 'media'
            ? 'filename'
            : collection === 'users'
              ? 'attributionLabel'
              : 'title'
      fetch(
        `/api/${collection}?limit=50&depth=0&where[${field}][like]=${encodeURIComponent(search)}`,
        { signal: controller.signal },
      )
        .then(
          (r) =>
            r.json() as Promise<{
              docs?: Array<{
                id: string | number
                title?: string
                name?: string
                singular?: string
                filename?: string
              }>
            }>,
        )
        .then((r) => setItems(r.docs || []))
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [collection, search, available])
  if (!available) return null
  return (
    <fieldset disabled={disabled}>
      <legend>{label}</legend>
      <input
        aria-label={`Search ${label}`}
        type="search"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="cf-picker-results">
        {items.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={value.includes(String(item.id))}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? single
                      ? [String(item.id)]
                      : [...value, String(item.id)]
                    : value.filter((v) => v !== String(item.id)),
                )
              }
            />
            {item.title ||
              item.name ||
              item.singular ||
              item.filename ||
              (item.attributionPreference ? item.attributionLabel : undefined) ||
              item.displayName ||
              item.email ||
              item.id}
          </label>
        ))}
      </div>
      {!!value.length && (
        <button type="button" onClick={() => onChange([])}>
          Clear selection ({value.length})
        </button>
      )}
    </fieldset>
  )
}
export const ViewBuilder: JSONFieldClientComponent = ({ path, readOnly }) => {
  const categoriesEnabled = useCategoriesEnabled()
  const { value = defaultView, setValue } = useField<ViewConfig>({ path }),
    [tab, setTab] = useState('Layout'),
    [family, setFamily] = useState('posts')
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const update = (patch: Partial<ViewConfig>) => setValue({ ...value, ...patch }),
    query = (patch: Partial<ViewConfig['query']>) => update({ query: { ...value.query, ...patch } })
  const rules = value.query.rules || []
  const rule = (i: number, patch: Partial<QueryRule>) =>
    query({ rules: rules.map((r, n) => (n === i ? { ...r, ...patch } : r)) })
  return (
    <section className="cf-editor">
      <div className="cf-row" role="tablist" aria-label="View settings">
        {['Layout', 'Style', 'Advanced'].map((t) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <fieldset disabled={readOnly}>
        {tab === 'Layout' && (
          <>
            <label>
              Heading
              <input
                value={value.heading || ''}
                onChange={(e) => update({ heading: e.target.value })}
              />
            </label>
            <label>
              Source
              <select
                value={value.query.source}
                onChange={(e) =>
                  query({ source: e.target.value as 'posts' | 'pages', rules: [] })
                }
              >
                <option value="posts">Posts</option>
                <option value="pages">Pages</option>
              </select>
            </label>
            <label>
              Display family
              <select value={family} onChange={(e) => setFamily(e.target.value)}>
                <option value="posts">Content layouts</option>
                <option value="events">Event layouts</option>
              </select>
            </label>
            <div className="cf-choices">
              {listViews()
                .filter((v) => v.family === family)
                .map((v) => (
                  <button
                    type="button"
                    key={v.key}
                    aria-pressed={value.layout === v.key}
                    onClick={() => update({ layout: v.key })}
                  >
                    <ViewThumbnail kind={v.thumbnail} />
                    {v.label}
                  </button>
                ))}
            </div>
            <h3>Content query</h3>
            <label>
              Match filter groups
              <select
                value={value.query.match || 'and'}
                onChange={(e) => query({ match: e.target.value as 'and' | 'or' })}
              >
                <option value="and">All groups (AND)</option>
                <option value="or">Any group (OR)</option>
              </select>
            </label>
            {rules.map((r, i) => (
              <fieldset key={i} hidden={!categoriesEnabled && r.field === 'categories'}>
                <div className="cf-row">
                  <label>
                    Field
                    <select
                      value={r.field}
                      onChange={(e) =>
                        rule(i, { field: e.target.value as QueryRule['field'], values: [] })
                      }
                    >
                      {['categories', 'tags', 'author', 'featured'].filter(f => categoriesEnabled || f !== 'categories').map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Match
                    <select
                      value={r.operator}
                      onChange={(e) =>
                        rule(i, { operator: e.target.value as QueryRule['operator'] })
                      }
                    >
                      <option value="any">Any selected</option>
                      <option value="all">All selected</option>
                      <option value="exclude">Exclude selected</option>
                    </select>
                  </label>
                </div>
                {r.field === 'featured' ? (
                  <label>
                    Featured
                    <select
                      value={r.values[0] || 'true'}
                      onChange={(e) => rule(i, { values: [e.target.value] })}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                ) : (
                  <RelationPicker
                    label="Values"
                    collection={
                      r.field === 'author'
                          ? 'users'
                          : r.field
                    }
                    value={r.values}
                    onChange={(values) => rule(i, { values })}
                  />
                )}
                <button
                  type="button"
                  onClick={() => query({ rules: rules.filter((_, n) => n !== i) })}
                >
                  Remove filter
                </button>
              </fieldset>
            ))}
            {value.query.source === 'posts' && (
              <button
                type="button"
                onClick={() =>
                  query({ rules: [...rules, { field: categoriesEnabled ? 'categories' : 'tags', operator: 'any', values: [] }] })
                }
              >
                Add filter group
              </button>
            )}
            <RelationPicker
              label="Only selected content (optional)"
              collection={value.query.source}
              value={value.query.ids || []}
              onChange={(ids) => query({ ids })}
            />
            <RelationPicker
              label="Exclude content"
              collection={value.query.source}
              value={value.query.excludeIDs || []}
              onChange={(ids) => query({ excludeIDs: ids })}
            />
            <div className="cf-row">
              <label>
                Order
                <select
                  value={value.query.sort || '-publishedAt'}
                  onChange={(e) => query({ sort: e.target.value })}
                >
                  {[
                    ['-publishedAt', 'Newest first'],
                    ['publishedAt', 'Oldest first'],
                    ['title', 'Title A–Z'],
                    ['-title', 'Title Z–A'],
                    ['-updatedAt', 'Recently updated'],
                    ['manual', 'Selected order'],
                  ].map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Items per page
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={value.query.limit || 9}
                  onChange={(e) => query({ limit: Number(e.target.value) })}
                />
              </label>
            </div>
            <p>Events are ordered by occurrence start time.</p>
          </>
        )}
        {tab === 'Style' && (
          <>
            <div className="cf-row">
              {(['tablet', 'mobile'] as const).map((breakpoint) => (
                <label key={breakpoint}>
                  {breakpoint} columns
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={value.responsiveColumns?.[breakpoint] ?? ''}
                    placeholder={breakpoint === 'tablet' ? '2' : '1'}
                    onChange={(e) =>
                      update({
                        responsiveColumns: {
                          ...value.responsiveColumns,
                          [breakpoint]: e.target.value ? Number(e.target.value) : undefined,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="cf-row">
              {(['columns', 'gap', 'radius', 'excerptLength'] as const).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    min={k === 'columns' ? 1 : 0}
                    max={k === 'columns' ? 6 : 500}
                    value={value[k] ?? { columns: 3, gap: 20, radius: 6, excerptLength: 180 }[k]}
                    onChange={(e) => update({ [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            {(['image', 'excerpt', 'taxonomy', 'date', 'author', 'readingTime'] as const).map(
              (k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={value[k] !== false}
                    onChange={(e) => update({ [k]: e.target.checked })}
                  />{' '}
                  Show {k}
                </label>
              ),
            )}
          </>
        )}
        {tab === 'Advanced' && (
          <>
            <label>
              Pagination
              <select
                value={value.pagination || 'numbers'}
                onChange={(e) => update({ pagination: e.target.value as ViewConfig['pagination'] })}
              >
                {['numbers', 'navigation', 'more', 'none'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {(['search', 'filters', 'dialog'] as const).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={!!value[k]}
                  onChange={(e) => update({ [k]: e.target.checked })}
                />{' '}
                Enable {k}
              </label>
            ))}
            <label>
              Display timezone
              <input
                value={value.timezone || 'UTC'}
                onChange={(e) => update({ timezone: e.target.value })}
              />
            </label>
            <div className="cf-row">
              <label>
                Published after
                <input
                  type="date"
                  value={value.query.start || ''}
                  onChange={(e) => query({ start: e.target.value })}
                />
              </label>
              <label>
                Published before
                <input
                  type="date"
                  value={value.query.end || ''}
                  onChange={(e) => query({ end: e.target.value })}
                />
              </label>
            </div>
          </>
        )}
        <ViewDesignEditor
          value={value.design}
          onChange={(design) => update({ design })}
          viewport={device}
          onDeviceChange={setDevice}
          tab={tab.toLowerCase() as 'layout' | 'style' | 'advanced'}
          disabled={readOnly}
          renderBackgroundMedia={(background, change) => (
            <BackgroundMediaPicker value={background} change={change} />
          )}
        />
      </fieldset>
      <div
        className="cf-preview"
        style={{ maxWidth: device === 'mobile' ? 390 : device === 'tablet' ? 768 : undefined }}
      >
        <h3>Live preview</h3>
        <DynamicView configuration={value} editing />
      </div>
    </section>
  )
}
