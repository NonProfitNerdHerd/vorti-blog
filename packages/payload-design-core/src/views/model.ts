/** Serializable contracts shared by editors, servers, and source adapters. */
import type { ContentNode } from '../content/model'
import type { ReactNode } from 'react'
export type TypeFieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'media'
  | 'url'
  | 'relationship'
  | 'eventSchedule'
export type TypeField = {
  id: string
  label: string
  kind: TypeFieldKind
  required?: boolean
  public?: boolean
  helpText?: string
  options?: string[]
  relationTo?: string
  defaultValue?: unknown
  rules?: FieldRule[]
}
export type FieldRule = {
  kind:
    | 'requiredWhen'
    | 'minLength'
    | 'maxLength'
    | 'email'
    | 'containsEmail'
    | 'contains'
    | 'excludes'
    | 'min'
    | 'max'
    | 'integer'
    | 'compare'
    | 'earliest'
    | 'latest'
    | 'protocols'
    | 'domains'
    | 'checked'
    | 'mimeTypes'
    | 'maxBytes'
  value?: string | number | boolean
  field?: string
  operator?: 'equals' | 'set' | 'empty' | 'before' | 'after'
  allowEqual?: boolean
  message?: string
}
export type PostTypeDefinition = {
  id: string | number
  key: string
  singular: string
  plural: string
  prefix: string
  icon: string
  capability: string
  fieldDefinitions: TypeField[]
  templates?: Array<string | number>
  defaultTemplate?: string | number
  archived?: boolean
  schemaVersion: number
}
export type EventSchedule = {
  start: string
  end: string
  timezone: string
  allDay?: boolean
  frequency?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval?: number
  weekdays?: number[]
  monthDays?: number[]
  until?: string
  count?: number
  exceptions?: Array<{ date: string; cancelled?: boolean; start?: string; end?: string }>
}
export type Occurrence = {
  id: string
  start: string
  end: string
  originalDate: string
  allDay: boolean
  timezone: string
}
export type QueryRule = {
  field: 'categories' | 'tags' | 'author' | 'featured'
  operator: 'any' | 'all' | 'exclude'
  values: string[]
}
export type ViewQuery = {
  source: 'posts' | 'pages'
  match?: 'and' | 'or'
  rules?: QueryRule[]
  ids?: string[]
  excludeIDs?: string[]
  sort?: string
  limit?: number
  start?: string
  end?: string
}
export type ViewConfig = {
  version: 1
  query: ViewQuery
  layout: string
  heading?: string
  columns?: number
  gap?: number
  image?: boolean
  excerpt?: boolean
  taxonomy?: boolean
  date?: boolean
  author?: boolean
  readingTime?: boolean
  excerptLength?: number
  search?: boolean
  filters?: boolean
  pagination?: 'numbers' | 'navigation' | 'more' | 'none'
  dialog?: boolean
  background?: string
  color?: string
  radius?: number
  timezone?: string
  design?: Pick<ContentNode, 'styles' | 'presentation'>
  responsiveColumns?: { tablet?: number; mobile?: number }
}
export type SavedViewReference = { viewID: string | number }
export type ViewItem = {
  id: string
  title: string
  url: string
  excerpt?: string
  image?: string
  date?: string
  author?: string
  readingTime?: number
  categories?: Array<{ id: string; name: string }>
  tags?: Array<{ id: string; name: string }>
  occurrence?: Occurrence
  location?: string
  latitude?: number
  longitude?: number
}
export type ViewResult = {
  categoriesEnabled?: boolean
  items: ViewItem[]
  page: number
  totalPages: number
  total: number
  config: ViewConfig
  facets?: {
    categories: Array<{ id: string; name: string }>
    tags: Array<{ id: string; name: string }>
  }
}
/** Assign consistent columns to connected groups of overlapping occurrences. */
export function occurrenceLanes(items: ViewItem[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>()
  let group: Array<{ id: string; lane: number }> = [],
    ends: number[] = [],
    groupEnd = -Infinity
  const flush = () => {
    for (const item of group) result.set(item.id, { lane: item.lane, lanes: ends.length })
    group = []
    ends = []
  }
  for (const item of [...items]
    .filter((item) => item.occurrence)
    .sort((a, b) => Date.parse(a.occurrence!.start) - Date.parse(b.occurrence!.start))) {
    const start = Date.parse(item.occurrence!.start),
      end = Date.parse(item.occurrence!.end)
    if (start >= groupEnd) flush()
    let lane = ends.findIndex((value) => value <= start)
    if (lane < 0) lane = ends.length
    ends[lane] = end
    groupEnd = Math.max(groupEnd, end)
    group.push({ id: item.id, lane })
  }
  flush()
  return result
}
export type ContentSourceDefinition = {
  key: string
  label: string
  fields: string[]
  capabilities: string[]
}
export type ViewDefinition = {
  key: string
  label: string
  family: 'posts' | 'events'
  capability?: string
  thumbnail: 'grid' | 'list' | 'split' | 'calendar' | 'slider' | 'map'
  render?: (props: { result: ViewResult; onSelect: (item: ViewItem) => void }) => ReactNode
}
export type ContentCapability = { key: string; label: string; requiredKinds?: TypeFieldKind[] }
const capabilities = new Map<string, ContentCapability>()
export function registerContentCapability(capability: ContentCapability) {
  if (!/^[a-z][a-z0-9-]*$/.test(capability.key) || capabilities.has(capability.key))
    throw new Error(`Invalid or duplicate capability ${capability.key}`)
  capabilities.set(capability.key, capability)
}
export const listContentCapabilities = () => [...capabilities.values()]
registerContentCapability({ key: 'content', label: 'Content' })
registerContentCapability({ key: 'event', label: 'Event', requiredKinds: ['eventSchedule'] })
const sources = new Map<string, ContentSourceDefinition>()
const views = new Map<string, ViewDefinition>()
export function registerContentSource(source: ContentSourceDefinition) {
  if (sources.has(source.key)) throw new Error(`Duplicate source ${source.key}`)
  sources.set(source.key, source)
}
export function registerView(view: ViewDefinition) {
  if (views.has(view.key)) throw new Error(`Duplicate view ${view.key}`)
  views.set(view.key, view)
}
export const listContentSources = () => [...sources.values()]
export const listViews = () => [...views.values()]
export const getView = (key: string) => views.get(key)
/** Named inserter entries remain central Saved View references after setup. */
export const viewBlockKind = (layout: string) => `contentView-${layout}`
export const viewForBlock = (kind: string) =>
  kind.startsWith('contentView-') ? getView(kind.slice('contentView-'.length)) : undefined
export const isViewPlacement = (kind: string) => kind === 'savedView' || !!viewForBlock(kind)
registerContentSource({
  key: 'posts',
  label: 'Posts',
  fields: ['categories', 'tags', 'author', 'featured'],
  capabilities: ['content', 'event'],
})
registerContentSource({ key: 'pages', label: 'Pages', fields: [], capabilities: ['content'] })
for (const [prefix, count, name, thumbnail] of [
  ['grid', 7, 'Post Grid', 'grid'],
  ['list', 4, 'Post List', 'list'],
  ['slider', 2, 'Post Slider', 'slider'],
  ['module', 2, 'Post Module', 'split'],
] as const)
  for (let i = 1; i <= count; i++)
    registerView({ key: `${prefix}-${i}`, label: `${name} ${i}`, family: 'posts', thumbnail })
for (const key of ['taxonomy', 'search', 'ticker'])
  registerView({
    key,
    label: key === 'ticker' ? 'News Ticker' : key === 'search' ? 'Search / Filter' : 'Taxonomy',
    family: 'posts',
    thumbnail: 'list',
  })
for (const [key, label, thumbnail] of [
  ['month', 'Month Calendar', 'calendar'],
  ['week', 'Week Calendar', 'calendar'],
  ['day', 'Day Calendar', 'calendar'],
  ['year', 'Year Calendar', 'calendar'],
  ['calendar', 'Switchable Calendar', 'calendar'],
  ['list', 'Event List', 'list'],
  ['agenda', 'Agenda', 'list'],
  ['grid', 'Event Grid', 'grid'],
  ['tiles', 'Event Tiles', 'grid'],
  ['masonry', 'Event Masonry', 'grid'],
  ['timetable', 'Timetable', 'calendar'],
  ['map', 'Event Map', 'map'],
  ['slider', 'Event Slider', 'slider'],
  ['carousel', 'Event Carousel', 'slider'],
  ['cover', 'Event Cover', 'split'],
  ['countdown', 'Event Countdown', 'split'],
  ['widget', 'Upcoming Events', 'list'],
  ['single', 'Single Event', 'split'],
] as const)
  registerView({ key: `event-${key}`, label, family: 'events', capability: 'event', thumbnail })
export const defaultView: ViewConfig = {
  version: 1,
  query: { source: 'posts', limit: 9, sort: '-publishedAt' },
  layout: 'grid-1',
  columns: 3,
  gap: 20,
  image: true,
  excerpt: true,
  taxonomy: true,
  date: true,
  pagination: 'numbers',
  search: true,
  filters: true,
}
export function documentURL(post: { slug?: string | null }) {
  return `/posts/${encodeURIComponent(post.slug || '__preview__')}`
}
