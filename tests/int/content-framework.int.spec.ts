import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { defaultView } from '@design-system/payload-design-core'
import { queryView, readSavedView } from '@/content-framework/query'

describe('Post Types and Saved Views publication boundaries', () => {
  let payload: Payload, req: PayloadRequest, type: number, event: number, view: number
  const stamp = Date.now()
  const schedule = {
    start: '2026-10-12T09:00',
    end: '2026-10-12T10:00',
    timezone: 'America/Chicago',
    frequency: 'weekly' as const,
    count: 5,
  }
  beforeAll(async () => {
    payload = await getPayload({ config })
    const user = await payload.create({
      collection: 'users',
      data: { username: (`framework-${stamp}@example.invalid`).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-32),
        email: `framework-${stamp}@example.invalid`,
        password: 'local-framework-password',
        role: 'administrator',
      },
    })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
    type = (
      await payload.create({
        collection: 'post-types',
        req,
        overrideAccess: false,
        data: {
          key: `events-${stamp}`,
          singular: 'Test Event',
          plural: 'Test Events',
          prefix: `events-${stamp}`,
          capability: 'event',
          _status: 'published',
          fieldDefinitions: [
            {
              id: 'schedule',
              label: 'Schedule',
              kind: 'eventSchedule',
              required: true,
              public: true,
            },
            { id: 'privateNote', label: 'Private', kind: 'text', public: false },
          ],
        },
      })
    ).id
  }, 120000)
  it('indexes published events and projects only public structured fields', async () => {
    event = (
      await payload.create({
        collection: 'posts',
        req,
        overrideAccess: false,
        data: {
          title: 'Recurring test',
          slug: `recurring-${stamp}`,
          postType: type,
          author: req.user!.id,
          _status: 'published',
          postTypeValues: { schedule, privateNote: 'Internal only' },
          contentLayout: { version: 1, nodes: [] },
        },
      })
    ).id
    const publicDoc = await payload.findByID({
      collection: 'posts',
      id: event,
      overrideAccess: false,
      depth: 0,
    })
    expect(publicDoc.postTypeValues).not.toHaveProperty('privateNote')
    const result = await queryView(
      payload,
      {
        ...defaultView,
        layout: 'event-month',
        query: { source: 'posts', postTypes: [String(type)] },
      },
      new URLSearchParams({ from: '2026-10-01', to: '2026-11-01' }),
    )
    expect(result.items).toHaveLength(3)
    expect(result.items[0].url).toBe(`/events-${stamp}/recurring-${stamp}`)
  })
  it('saving an event draft preserves the live series until publication', async () => {
    await payload.update({
      collection: 'posts',
      id: event,
      req,
      draft: true,
      overrideAccess: false,
      data: {
        _status: 'draft',
        postTypeValues: {
          schedule: { ...schedule, start: '2026-10-12T12:00', end: '2026-10-12T13:00' },
        },
      },
    })
    const index = await payload.find({
      collection: 'event-series',
      where: { post: { equals: event } },
      depth: 0,
    })
    expect(index.docs[0].start).toBe('2026-10-12T14:00:00.000Z')
  })
  it('keeps Saved View drafts separate and protects referenced published definitions', async () => {
    view = (
      await payload.create({
        collection: 'saved-views',
        req,
        overrideAccess: false,
        data: { name: 'Reusable test', configuration: defaultView, _status: 'published' },
      })
    ).id
    await payload.create({
      collection: 'pages',
      req,
      data: {
        title: 'View placement',
        slug: `view-placement-${stamp}`,
        _status: 'published',
        contentLayout: {
          version: 1,
          nodes: [{ id: `view-${stamp}`, kind: 'savedView', props: { viewID: String(view) } }],
        },
      },
    })
    await payload.update({
      collection: 'saved-views',
      id: view,
      req,
      draft: true,
      data: { _status: 'draft', configuration: { ...defaultView, layout: 'grid-2' } },
    })
    expect((await readSavedView(payload, String(view))).layout).toBe('grid-1')
    expect(
      (await readSavedView(payload, String(view), { user: req.user, draft: true })).layout,
    ).toBe('grid-2')
    await expect(payload.delete({ collection: 'saved-views', id: view, req })).rejects.toThrow(
      'used by published content',
    )
  })
  it('denies anonymous definition writes and private index reads', async () => {
    await expect(
      payload.create({
        collection: 'post-types',
        overrideAccess: false,
        data: {
          key: 'forged',
          singular: 'Forged',
          plural: 'Forged',
          prefix: 'forged',
          capability: 'content',
        },
      }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'event-series', overrideAccess: false }),
    ).rejects.toThrow()
  })
  it('removes an event projection before its owning document', async () => {
    await payload.delete({ collection: 'posts', id: event, req })
    expect(
      (await payload.count({ collection: 'event-series', where: { post: { equals: event } } }))
        .totalDocs,
    ).toBe(0)
  })
  it('orders selected Pages before pagination and supports their separate source', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++)
      ids.push(
        String(
          (
            await payload.create({
              collection: 'pages',
              req,
              data: { title: `Ordered ${i}`, slug: `ordered-${stamp}-${i}`, _status: 'published' },
            })
          ).id,
        ),
      )
    const result = await queryView(
      payload,
      {
        ...defaultView,
        query: { source: 'pages', ids: [ids[2], ids[0], ids[1]], sort: 'manual', limit: 1 },
      },
      new URLSearchParams({ page: '2' }),
    )
    expect(result.items.map((item) => item.id)).toEqual([ids[0]])
    expect(result.totalPages).toBe(3)
  })
  it('enforces type-default Template locks through direct writes', async () => {
    const template = await payload.create({
      collection: 'design-templates',
      req,
      data: {
        name: 'Default type layout',
        slug: `default-type-${stamp}`,
        status: 'published',
        _status: 'published',
        allowedCollections: ['posts'],
        layout: [
          {
            id: 'intro',
            type: 'field',
            fieldType: 'shortText',
            label: 'Intro',
            content: { source: 'static', value: 'Template-owned design' },
          },
        ],
      },
    })
    const definition = await payload.create({
      collection: 'post-types',
      req,
      data: {
        key: `locked-${stamp}`,
        prefix: `locked-${stamp}`,
        singular: 'Locked',
        plural: 'Locked',
        capability: 'content',
        templates: [template.id],
        defaultTemplate: template.id,
        _status: 'published',
      },
    })
    const post = await payload.create({
      collection: 'posts',
      req,
      draft: true,
      data: {
        title: 'Default template content',
        slug: `default-content-${stamp}`,
        postType: definition.id,
        author: req.user!.id,
      },
    })
    await expect(
      payload.update({
        collection: 'posts',
        id: post.id,
        req,
        data: {
          contentLayout: {
            version: 1,
            nodes: [{ id: 'forged', kind: 'paragraph', text: 'Replace template' }],
          },
        },
      }),
    ).rejects.toThrow('Template structure is locked')
  })
  it('rejects unsafe shared design and unpublished references', async () => {
    await expect(
      payload.create({
        collection: 'saved-views',
        req,
        data: {
          name: 'Unsafe',
          _status: 'published',
          configuration: {
            ...defaultView,
            design: { presentation: { css: 'body { display:none }' } },
          },
        },
      }),
    ).rejects.toThrow()
    const draft = await payload.create({
      collection: 'saved-views',
      req,
      data: { name: 'Unpublished view', configuration: defaultView, _status: 'draft' },
    })
    await expect(
      payload.create({
        collection: 'pages',
        req,
        data: {
          title: 'Invalid placement',
          slug: `unpublished-placement-${stamp}`,
          _status: 'published',
          contentLayout: {
            version: 1,
            nodes: [{ id: 'view', kind: 'savedView', props: { viewID: String(draft.id) } }],
          },
        },
      }),
    ).rejects.toThrow('Publish the referenced Saved View')
    const definition = await payload.create({
      collection: 'post-types',
      req,
      data: {
        key: `view-ref-${stamp}`,
        singular: 'View reference',
        plural: 'View references',
        prefix: `view-ref-${stamp}`,
        capability: 'content',
        _status: 'published',
        fieldDefinitions: [
          {
            id: 'display',
            label: 'Display',
            kind: 'relationship',
            relationTo: 'saved-views',
            public: true,
          },
        ],
      },
    })
    await expect(
      payload.create({
        collection: 'posts',
        req,
        data: {
          title: 'Unpublished declared view',
          slug: `declared-view-${stamp}`,
          author: req.user!.id,
          postType: definition.id,
          postTypeValues: { display: draft.id },
          _status: 'published',
        },
      }),
    ).rejects.toThrow('Publish the referenced Saved View')
  })
})
