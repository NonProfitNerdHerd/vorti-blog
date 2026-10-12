'use client'
import { useEffect, useState, type ComponentType } from 'react'
import { BlockGlyph } from '../blocks/BlockGlyph'
type Catalog = typeof import('./PostTypeIconCatalog')
let catalogPromise: Promise<Catalog> | undefined
const load = () => (catalogPromise ||= import('./PostTypeIconCatalog'))
export function PostTypeIcon({ value }: { value: string }) {
  const [catalog, setCatalog] = useState<Catalog>()
  useEffect(() => {
    if (value.startsWith('lucide:')) void load().then(setCatalog)
  }, [value])
  if (!value.startsWith('lucide:')) return <BlockGlyph kind={value} />
  const Icon = catalog?.catalog[value.slice(7)] as
    ComponentType<{ size: number; 'aria-hidden': boolean }> | undefined
  return Icon ? <Icon size={22} aria-hidden /> : <span aria-hidden>◇</span>
}
const categories: Record<string, RegExp> = {
  'Time & events': /calendar|clock|alarm|timer|hourglass|ticket|party/,
  'People & community': /user|person|contact|hand|heart|accessibility/,
  'Content & communication': /file|book|newspaper|mail|message|notebook|text|pen|folder/,
  'Places & travel': /map|pin|house|building|landmark|plane|car|bus|train|hotel|compass/,
  'Business & shopping':
    /briefcase|chart|badge|credit|wallet|dollar|store|shopping|receipt|package/,
  'Media & technology': /image|camera|video|music|mic|computer|monitor|phone|server|code|wifi/,
  'Nature & activities': /tree|flower|leaf|sun|cloud|moon|mountain|bike|ball|tent|fish|bird/,
}
export function PostTypeIconPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState(false)
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('All'),
    [limit, setLimit] = useState(60)
  useEffect(() => {
    void load()
      .then(setCatalog)
      .catch(() => setError(true))
  }, [])
  const names = Object.keys(catalog?.catalog || {}).filter((name) => {
    const normalized = name.replace(/([A-Z])/g, ' $1').toLowerCase()
    const query = search.toLowerCase().replace(/events?|dates?/g, 'calendar')
    return (
      normalized.includes(query) && (category === 'All' || categories[category].test(normalized))
    )
  })
  return (
    <fieldset disabled={disabled} className="pt-icons">
      <legend>Post Type icon</legend>
      <p>
        <PostTypeIcon value={value} /> Selected: {value.replace('lucide:', '')}
      </p>
      <label>
        Search icons
        <input
          type="search"
          value={search}
          placeholder="Calendar, people, news, location…"
          onChange={(e) => {
            setSearch(e.target.value)
            setLimit(60)
          }}
        />
      </label>
      <label>
        Category
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setLimit(60)
          }}
        >
          {['All', ...Object.keys(categories)].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {!catalog && (
        <p role="status">
          {error
            ? 'Icons could not load. Reload this page to retry; your current icon is unchanged.'
            : 'Loading icon library…'}
        </p>
      )}
      {catalog && <p role="status">{names.length} icons found</p>}
      <div className="pt-icon-grid">
        {names.slice(0, limit).map((name) => {
          const Icon = catalog!.catalog[name]
          return (
            <button
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={value === `lucide:${name}`}
              key={name}
              onClick={() => onChange(`lucide:${name}`)}
            >
              <Icon size={24} aria-hidden />
              <small>{name.replace(/([A-Z])/g, ' $1').trim()}</small>
            </button>
          )
        })}
      </div>
      {names.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 60)}>
          Show more icons
        </button>
      )}
    </fieldset>
  )
}
