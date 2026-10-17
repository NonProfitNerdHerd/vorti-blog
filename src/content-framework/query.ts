import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import {
  defaultView,
  documentURL,
  expandSchedule,
  getView,
  type ViewConfig,
  type ViewItem,
  type ViewResult,
  type EventSchedule,
  type TypeField,
} from '@design-system/payload-design-core'
import { mediaURL } from '../lib/media'
import { validateView } from './validation'
import { readCategoriesEnabled } from '../lib/system-settings'
type Context = { user?: PayloadRequest['user']; draft?: boolean }
export async function readSavedView(payload: Payload, id: string, context: Context = {}) {
  const result = await payload.find({
    collection: 'saved-views' as CollectionSlug,
    where: {
      and: [
        { id: { equals: id } },
        ...(!context.draft ? [{ _status: { equals: 'published' } }] : []),
      ],
    },
    draft: !!context.draft && !!context.user,
    user: context.user,
    overrideAccess: false,
    limit: 1,
    depth: 0,
  })
  const view = result.docs[0] as unknown as { configuration: ViewConfig } | undefined
  if (!view) throw new Error('Saved View is unavailable')
  return view.configuration
}
export async function queryView(
  payload: Payload,
  config: ViewConfig,
  params: URLSearchParams = new URLSearchParams(),
  context: Context = {},
): Promise<ViewResult> {
  validateView(config)
  const categoriesEnabled = await readCategoriesEnabled(payload)
  const query = config.query,
    event = getView(config.layout)?.capability === 'event'
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1)),
    limit = Math.min(100, Math.max(1, query.limit || 9))
  const rules: Where[] = []
  if (query.postTypes?.length) rules.push({ postType: { in: query.postTypes } })
  if (query.ids?.length) rules.push({ id: { in: query.ids } })
  if (query.excludeIDs?.length) rules.push({ id: { not_in: query.excludeIDs } })
  const dateField = query.source === 'pages' ? 'updatedAt' : 'publishedAt'
  if (query.start) rules.push({ [dateField]: { greater_than_equal: query.start } })
  if (query.end) rules.push({ [dateField]: { less_than_equal: query.end } })
  const filters: Where[] = []
  for (const rule of query.rules || []) {
    if (!rule.values.length) continue
    const values = rule.field === 'featured' ? rule.values.map((v) => v === 'true') : rule.values
    if (rule.operator === 'all')
      filters.push({ and: values.map((value) => ({ [rule.field]: { equals: value } })) })
    else filters.push({ [rule.field]: { [rule.operator === 'exclude' ? 'not_in' : 'in']: values } })
  }
  if (filters.length) rules.push({ [query.match === 'or' ? 'or' : 'and']: filters })
  if (!context.draft) rules.push({ _status: { equals: 'published' } })
  if (config.search && params.get('search'))
    rules.push({ title: { like: params.get('search')!.slice(0, 200) } })
  if ((config.filters || config.layout === 'taxonomy') && query.source === 'posts')
    for (const field of ['categories', 'tags'])
      if ((field !== 'categories' || categoriesEnabled) && params.get(field))
        rules.push({ [field]: { in: params.get(field)!.split(',').slice(0, 30) } })
  const from = Date.parse(params.get('from') || new Date().toISOString()),
    to = Date.parse(params.get('to') || new Date(from + 90 * 86400000).toISOString())
  if (event) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86400000)
      throw new Error('Choose a calendar range of at most 366 days')
    const types = await payload.find({
      collection: 'post-types' as CollectionSlug,
      where: { and: [{ capability: { equals: 'event' } }, { _status: { equals: 'published' } }] },
      limit: 100,
      depth: 0,
      overrideAccess: false,
      user: context.user,
    })
    rules.push({ postType: { in: types.docs.map((d) => d.id) } })
    // The projection is only a candidate index. Recheck every source document's access and publication.
    if (!context.draft) {
      const candidates: Array<string | number> = []
      for (let p = 1; ; p++) {
        const series = await payload.find({
          collection: 'event-series' as CollectionSlug,
          where: {
            or: [
              { recurring: { equals: true } },
              {
                and: [
                  { start: { less_than: new Date(to).toISOString() } },
                  { end: { greater_than: new Date(from).toISOString() } },
                ],
              },
            ],
          },
          page: p,
          limit: 200,
          depth: 0,
          overrideAccess: true,
        })
        for (const item of series.docs) candidates.push((item as unknown as { post: number }).post)
        if (candidates.length > 10000)
          throw new Error('Too many event series; narrow the saved query')
        if (!series.hasNextPage) break
      }
      rules.push({ id: { in: candidates } })
    }
  }
  let sort = ['-publishedAt', 'publishedAt', 'title', '-title', '-updatedAt'].includes(
    query.sort || '',
  )
    ? query.sort!
    : '-publishedAt'
  if (query.source === 'pages') sort = sort.replace('publishedAt', 'updatedAt')
  const manual = !event && query.sort === 'manual' && !!query.ids?.length
  const collect = event || manual
  const documents: Array<Record<string, unknown>> = []
  let total = 0,
    totalPages = 1
  for (let p = collect ? 1 : page; ; p++) {
    const response = await payload.find({
      collection: query.source,
      draft: !!context.draft && !!context.user,
      user: context.user,
      overrideAccess: false,
      where: { and: rules },
      depth: 1,
      page: p,
      limit: collect ? 100 : limit,
      sort,
    })
    documents.push(...(response.docs as unknown as Array<Record<string, unknown>>))
    total = response.totalDocs
    totalPages = response.totalPages
    if (!collect || !response.hasNextPage) break
    if (documents.length > 10000) throw new Error('Too many events; narrow the saved query')
  }
  const taxonomy = (value: unknown): Array<{ id: string; name: string }> =>
    Array.isArray(value)
      ? value
          .filter((v) => v && typeof v === 'object')
          .map((v) => ({ id: String(v.id), name: String(v.name || v.title || '') }))
      : []
  let items: ViewItem[] = []
  for (const doc of documents) {
    const type =
      doc.postType && typeof doc.postType === 'object'
        ? (doc.postType as Record<string, unknown>)
        : undefined
    const author =
      doc.author && typeof doc.author === 'object'
        ? (doc.author as Record<string, unknown>)
        : undefined
    const item: ViewItem = {
      id: String(doc.id),
      title: String(doc.title || 'Untitled'),
      url: query.source === 'posts' ? documentURL(doc) : `/${encodeURIComponent(String(doc.slug))}`,
      excerpt: String(doc.excerpt || ''),
      image: mediaURL(doc.featuredImage as never) || undefined,
      date: doc.publishedAt ? String(doc.publishedAt) : undefined,
      author: author?.profilePublic ? String(author.displayName || '') : undefined,
      categories: categoriesEnabled ? taxonomy(doc.categories) : [],
      tags: taxonomy(doc.tags),
      readingTime: Math.max(
        1,
        Math.ceil(JSON.stringify(doc.content || doc.contentLayout || '').split(/\s+/).length / 200),
      ),
    }
    if (event) {
      const fields = (type?.fieldDefinitions || []) as TypeField[],
        values = (doc.postTypeValues || {}) as Record<string, unknown>
      const scheduleField = fields.find((f) => f.kind === 'eventSchedule' && f.public)
      const schedule = scheduleField && (values[scheduleField.id] as EventSchedule | undefined)
      if (!schedule) continue
      const publicValue = (id: string) =>
        fields.some((f) => f.id === id && f.public) ? values[id] : undefined
      for (const occurrence of expandSchedule(schedule, from, to, String(doc.id)))
        items.push({
          ...item,
          id: occurrence.id,
          occurrence,
          location: String(publicValue('location') || ''),
          latitude:
            typeof publicValue('latitude') === 'number'
              ? Number(publicValue('latitude'))
              : undefined,
          longitude:
            typeof publicValue('longitude') === 'number'
              ? Number(publicValue('longitude'))
              : undefined,
        })
    } else items.push(item)
  }
  if (event) {
    items.sort(
      (a, b) => a.occurrence!.start.localeCompare(b.occurrence!.start) || a.id.localeCompare(b.id),
    )
    total = items.length
    totalPages = Math.max(1, Math.ceil(total / limit))
    // Calendar windows must contain all occurrences; paginated event lists use the requested page.
    if (
      ![
        'event-month',
        'event-week',
        'event-day',
        'event-year',
        'event-calendar',
        'event-timetable',
        'event-map',
      ].includes(config.layout)
    )
      items = items.slice((page - 1) * limit, page * limit)
  }
  if (manual) {
    items.sort((a, b) => query.ids!.indexOf(a.id) - query.ids!.indexOf(b.id))
    total = items.length
    totalPages = Math.max(1, Math.ceil(total / limit))
    items = items.slice((page - 1) * limit, page * limit)
  }
  let facets: ViewResult['facets']
  if ((config.filters || config.layout === 'taxonomy') && query.source === 'posts') {
    const results = await Promise.all(
      (['categories', 'tags'] as const).map((collection) =>
        collection === 'categories' && !categoriesEnabled
          ? Promise.resolve({ docs: [] })
          : payload.find({
              collection,
              overrideAccess: false,
              user: context.user,
              depth: 0,
              pagination: false,
              select: { name: true },
            }),
      ),
    )
    facets = {
      categories: results[0].docs.map((doc) => ({ id: String(doc.id), name: doc.name })),
      tags: results[1].docs.map((doc) => ({ id: String(doc.id), name: doc.name })),
    }
  }
  return {
    items,
    page,
    totalPages,
    total,
    facets,
    categoriesEnabled,
    config: { ...defaultView, ...config },
  }
}
