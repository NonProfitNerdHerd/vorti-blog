import { createLocalReq, type Payload, type CollectionSlug } from 'payload'
import { defaultView, listViews, type TypeField } from '@design-system/payload-design-core'

export const eventFields: TypeField[] = [
  { id: 'schedule', label: 'Event schedule', kind: 'eventSchedule', required: true, public: true },
  { id: 'location', label: 'Venue', kind: 'text', public: true },
  { id: 'organizer', label: 'Organizer', kind: 'text', public: true },
  { id: 'latitude', label: 'Latitude', kind: 'number', public: true },
  { id: 'longitude', label: 'Longitude', kind: 'number', public: true },
  { id: 'eventLink', label: 'External event link', kind: 'url', public: true },
]

/** Repeatable application setup. Existing user-authored records are never overwritten. */
export async function setupContentFramework(
  payload: Payload,
  administratorID: number,
  demonstrations = false,
) {
  const administrator = await payload.findByID({ collection: 'users', id: administratorID })
  if (administrator.role !== 'administrator') throw new Error('Setup requires an administrator')
  const req = await createLocalReq({ user: { ...administrator, collection: 'users' } }, payload)
  async function ensure(
    collection: CollectionSlug,
    key: string,
    value: string,
    data: Record<string, unknown>,
  ) {
    const found = await payload.find({
      collection,
      where: { [key]: { equals: value } },
      limit: 1,
      depth: 0,
      req,
    })
    return found.docs[0] || payload.create({ collection, req, data: data as never })
  }
  const postType = await ensure('post-types', 'key', 'post', {
    key: 'post',
    prefix: 'posts',
    singular: 'Post',
    plural: 'Posts',
    icon: 'paragraph',
    capability: 'content',
    fieldDefinitions: [],
    _status: 'published',
  })
  const eventType = await ensure('post-types', 'key', 'event', {
    key: 'event',
    prefix: 'events',
    singular: 'Event',
    plural: 'Events',
    icon: 'countdown',
    capability: 'event',
    fieldDefinitions: eventFields,
    _status: 'published',
  })
  if (!demonstrations) return { postType: postType.id, eventType: eventType.id, pages: [] }
  const category = await ensure('categories', 'slug', 'framework-demonstration', {
    name: 'Framework demonstration',
    slug: 'framework-demonstration',
  })
  const tag = await ensure('tags', 'slug', 'framework-demo', {
    name: 'Framework demo',
    slug: 'framework-demo',
  })
  const media = await payload.find({ collection: 'media', limit: 12, depth: 0, req })
  const content = (text: string) => ({
    version: 1,
    nodes: [{ id: 'demo-body', kind: 'paragraph', text }],
  })
  const now = new Date()
  const month = now.toISOString().slice(0, 7)
  const posts = []
  for (let i = 0; i < 12; i++) {
    posts.push(
      await ensure('posts', 'slug', `framework-demo-story-${i + 1}`, {
        title:
          [
            'A new chapter for our community',
            'Behind the scenes',
            'People who make a difference',
            'Ideas for the season',
            'Discover something local',
            'The week in pictures',
          ][i % 6] + (i > 5 ? ' — part two' : ''),
        slug: `framework-demo-story-${i + 1}`,
        postType: postType.id,
        author: administratorID,
        excerpt:
          'Demonstration content for reusable grids, lists, sliders, and modules. Edit the Saved View once to update every placement.',
        categories: [category.id],
        tags: [tag.id],
        featured: i < 3,
        featuredImage: media.docs[i % Math.max(1, media.docs.length)]?.id,
        contentLayout: content(
          'This is clearly labeled demonstration content. It can be edited or deleted after reviewing the framework.',
        ),
        publishedAt: new Date(now.getTime() - i * 86400000).toISOString(),
        _status: 'published',
      }),
    )
  }
  for (let i = 0; i < 8; i++) {
    const date = `${month}-${String(3 + i * 3).padStart(2, '0')}`
    await ensure('posts', 'slug', `framework-demo-event-${i + 1}`, {
      title: [
        'Community gathering',
        'Creative workshop',
        'Walking tour',
        'Open studio',
        'Community market',
        'Evening conversation',
        'Volunteer morning',
        'Weekend exhibition',
      ][i],
      slug: `framework-demo-event-${i + 1}`,
      postType: eventType.id,
      author: administratorID,
      excerpt:
        'A demonstration recurring event with a timezone-aware schedule and an independently rendered event page.',
      categories: [category.id],
      tags: [tag.id],
      featuredImage: media.docs[i % Math.max(1, media.docs.length)]?.id,
      postTypeValues: {
        schedule: {
          start: `${date}T${i % 2 ? '17' : '09'}:00`,
          end: `${date}T${i % 2 ? '19' : '11'}:00`,
          timezone: 'America/Chicago',
          frequency: i % 2 ? 'weekly' : 'daily',
          interval: i % 2 ? 1 : 7,
          count: 20,
        },
        location: 'Stevens Point, Wisconsin',
        organizer: 'Framework demonstration',
        latitude: 44.5236 + i * 0.006,
        longitude: -89.5746 + i * 0.005,
      },
      contentLayout: content(
        'Event details work without selecting a custom Template. The schedule belongs to the Post Type, independently of presentation.',
      ),
      publishedAt: now.toISOString(),
      _status: 'published',
    })
  }
  const pages: Array<{ slug: string; view: number | string; page: number | string }> = []
  const templates = []
  for (const variant of ['editorial', 'feature']) {
    templates.push(
      await ensure('design-templates', 'slug', `framework-demo-${variant}`, {
        name: `Demo — ${variant} page`,
        slug: `framework-demo-${variant}`,
        status: 'published',
        _status: 'published',
        allowedCollections: ['posts'],
        sections: [],
        layout: [
          {
            id: 'demo-container',
            type: 'layout',
            layout: 'stack',
            style: {
              spacing: 'large',
              background: variant === 'feature' ? 'muted' : 'transparent',
            },
            children: [
              {
                id: 'demo-heading',
                type: 'field',
                fieldType: 'shortText',
                label: 'Section heading',
                content: {
                  source: 'static',
                  value: variant === 'feature' ? 'Featured story' : 'From the journal',
                },
              },
              {
                id: 'demo-excerpt',
                type: 'field',
                fieldType: 'longText',
                label: 'Summary',
                content: { source: 'document', field: 'excerpt' },
              },
            ],
          },
        ],
      }),
    )
  }
  const currentType = await payload.findByID({
    collection: 'post-types',
    id: postType.id,
    depth: 0,
    req,
  })
  const allowed = [
    ...new Set([
      ...(currentType.templates || []).map((item) => (typeof item === 'object' ? item.id : item)),
      ...templates.map((item) => item.id),
    ]),
  ]
  await payload.update({
    collection: 'post-types',
    id: postType.id,
    req,
    data: { templates: allowed, _status: 'published' },
  })
  for (let i = 0; i < templates.length; i++)
    await payload.update({
      collection: 'posts',
      id: posts[i].id,
      req,
      data: { designTemplate: templates[i].id, _status: 'published' },
    })
  for (const definition of listViews()) {
    const view = await ensure('saved-views', 'name', `Demo — ${definition.label}`, {
      name: `Demo — ${definition.label}`,
      _status: 'published',
      configuration: {
        ...defaultView,
        layout: definition.key,
        heading: definition.label,
        timezone: 'America/Chicago',
        search: true,
        filters: true,
        query: {
          source: 'posts',
          postTypes: [String(definition.family === 'events' ? eventType.id : postType.id)],
          rules: [{ field: 'tags', operator: 'any', values: [String(tag.id)] }],
          limit: 9,
          sort: '-publishedAt',
        },
      },
    })
    const slug = `demo-${definition.key}`
    const page = await ensure('pages', 'slug', slug, {
      title: `Framework demo: ${definition.label}`,
      slug,
      _status: 'published',
      contentLayout: {
        version: 1,
        nodes: [
          {
            id: 'demo-intro',
            kind: 'paragraph',
            text: 'This page references a centrally managed Saved View. Its query and appearance are shared with every other placement of that view.',
          },
          { id: 'demo-view', kind: 'savedView', props: { viewID: String(view.id) } },
        ],
      },
    })
    pages.push({ slug, view: view.id, page: page.id })
  }
  await ensure('pages', 'slug', 'framework-demo', {
    title: 'Post Types and Saved Views — demonstration',
    slug: 'framework-demo',
    _status: 'published',
    contentLayout: {
      version: 1,
      nodes: [
        {
          id: 'intro',
          kind: 'paragraph',
          text: 'Explore each display family below. Posts and Events share the Posts destination; Post Types own fields, Templates own full-page presentation, and Saved Views own reusable queries and layouts.',
        },
        ...listViews().map((definition, i) => ({
          id: `demo-link-${i}`,
          kind: 'button',
          text: definition.label,
          url: `/demo-${definition.key}`,
        })),
      ],
    },
  })
  return { postType: postType.id, eventType: eventType.id, pages }
}
