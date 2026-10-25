import { fixtureDerivedRequest } from '../helpers/native-authority'
import { createChapterUser } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { resolveDocumentBlocks } from '@/lib/content-layout'
import { defaultView } from '@design-system/payload-design-core'
import { queryView } from '@/content-framework/query'

describe('Posts and reusable starting templates', () => {
  let payload: Payload, req: PayloadRequest
  const stamp = Date.now()
  beforeAll(async () => {
    payload = await getPayload({ config })
    const user = await createChapterUser(payload, 'administrator', { collection: 'users', data: { username: `templates-${stamp}`, email: `templates-${stamp}@example.invalid`, password: 'local-template-test', role: 'administrator' } })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  })
  it('has no Post Type collection or fields and keeps workspace collections', () => {
    expect(payload.config.collections.some(item => String(item.slug) === 'post-types')).toBe(false)
    for (const slug of ['review-tasks', 'task-projects', 'task-boards', 'users', 'media', 'pages']) expect(payload.collections[slug as CollectionSlug]).toBeDefined()
  })
  it('publishes a blank block Post with automatic authorship', async () => {
    const post = await payload.create({ collection: 'posts', overrideAccess: false, req, data: { title: 'Blank blocks', slug: `blank-${stamp}`, _status: 'published', contentLayout: { version: 1, nodes: [{ id: 'paragraph', kind: 'paragraph', text: 'Independent content' }] } } as never })
    expect(typeof post.author === 'object' ? post.author.id : post.author).toBe(req.user!.id)
    expect(post.designTemplate).toBeFalsy()
    expect((await resolveDocumentBlocks(payload, post as unknown as Record<string, unknown>))?.[0].text).toBe('Independent content')
  })
  it('rejects retired field bindings through direct template writes', async () => {
    await expect(payload.create({ collection: 'design-templates', req, data: { name: 'Invalid binding', allowedCollections: ['posts'], layout: [{ id: 'retired', type: 'field', fieldType: 'shortText', label: 'Retired', content: { source: 'postType', fieldId: 'retired' } }] } as never })).rejects.toThrow('supported field binding')
  })
  it('rejects case-insensitive duplicate template names through native APIs', async () => {
    await payload.create({ collection: 'design-templates', req, draft: true, data: { name: `Unique ${stamp}`, slug: `unique-${stamp}`, allowedCollections: ['posts'] } })
    await expect(payload.create({ collection: 'design-templates', req, draft: true, data: { name: ` UNIQUE ${stamp} `, slug: `another-${stamp}`, allowedCollections: ['posts'] } })).rejects.toMatchObject({ data: { errors: expect.arrayContaining([expect.objectContaining({ path: 'name', message: 'A template with this name already exists.' })]) } })
  })
  it('records first publication for Pages without rewriting existing dates', async () => {
    const page = await payload.create({ collection: 'pages', req, data: { title: 'Publication test', slug: `publication-${stamp}`, _status: 'draft' } })
    expect(page.publishedAt).toBeFalsy()
    const published = await payload.update({ collection: 'pages', req, id: page.id, data: { _status: 'published' } })
    expect(published.publishedAt).toBeTruthy()
    const edited = await payload.update({ collection: 'pages', req, id: page.id, data: { title: 'Unrelated edit' } })
    expect(edited.publishedAt).toBe(published.publishedAt)
  })
  it('freezes template fields and defaults and survives source edits/deletion', async () => {
    const template = await payload.create({ collection: 'design-templates', req, data: { name: `Starting layout ${stamp}`, slug: `starting-${stamp}`, allowedCollections: ['posts'], status: 'published', _status: 'published', customFields: [{ id: 'intro', label: 'Intro', fieldType: 'shortText', defaultValue: 'Starting text' }], layout: [{ id: 'intro', type: 'field', fieldType: 'shortText', label: 'Intro', content: { source: 'customField', fieldId: 'intro' } }] } as never })
    const post = await payload.create({ collection: 'posts', req, overrideAccess: false, draft: true, data: { title: 'From template', slug: `from-template-${stamp}`, designTemplate: template.id } })
    expect(post.templateSnapshot).toBeTruthy()
    expect(post.templateValues).toMatchObject({ intro: 'Starting text' })
    await payload.update({ collection: 'design-templates', id: template.id, req, data: { layout: [{ id: 'replacement', type: 'field', fieldType: 'shortText', label: 'New layout', content: { source: 'static', value: 'Changed source' } }] } })
    const updated = await payload.update({ collection: 'posts', id: post.id, req, overrideAccess: false, data: { templateValues: { intro: 'Post only' }, _status: 'published' } })
    expect((await resolveDocumentBlocks(payload, updated as unknown as Record<string, unknown>))?.[0].text).toBe('Post only')
    expect((await payload.findByID({ collection: 'design-templates', id: template.id, req })).layout).not.toEqual((post.templateSnapshot as { template: { layout: unknown } }).template.layout)
    // Delete through native APIs: frozen Posts should remain publishable/renderable.
    await payload.delete({ collection: 'design-templates', id: template.id, req })
    const reopened = await payload.findByID({ collection: 'posts', id: post.id, depth: 0, req })
    expect((await resolveDocumentBlocks(payload, reopened as unknown as Record<string, unknown>))?.[0].text).toBe('Post only')
  })
  it('keeps recurring event calendars without a content-type registry', async () => {
    const schedule = { start: '2026-10-12T09:00', end: '2026-10-12T10:00', timezone: 'America/Chicago', frequency: 'weekly', count: 5 }
    const post = await payload.create({ collection: 'posts', req, data: { title: 'Event', slug: `event-${stamp}`, author: req.user!.id, event: { schedule }, _status: 'published' } })
    const result = await queryView(payload, { ...defaultView, layout: 'event-month', query: { source: 'posts', ids: [String(post.id)] } }, new URLSearchParams({ from: '2026-10-01', to: '2026-11-01' }))
    expect(result.items).toHaveLength(3)
    expect(result.items[0].url).toBe(`/posts/event-${stamp}`)
    await payload.update({ collection: 'posts', id: post.id, req, draft: true, data: { event: { schedule: { ...schedule, start: '2026-10-12T12:00', end: '2026-10-12T13:00' } } } })
    const series = await payload.find({ req: await fixtureDerivedRequest(payload), collection: 'event-series', where: { post: { equals: post.id } } })
    expect(series.docs[0].start).toBe('2026-10-12T14:00:00.000Z')
    await payload.update({ collection: 'posts', id: post.id, req, data: { event: null, _status: 'published' } })
    expect((await payload.count({ req: await fixtureDerivedRequest(payload), collection: 'event-series', where: { post: { equals: post.id } } })).totalDocs).toBe(0)
  })
  it('requires an enabled event schedule for publication while permitting unfinished drafts', async () => {
    const data = { title: 'Incomplete event', slug: `incomplete-${stamp}`, author: req.user!.id, event: {}, _status: 'published' as const }
    await expect(payload.create({ collection: 'posts', req, data })).rejects.toThrow('Event schedule')
    await expect(payload.create({ collection: 'posts', req, draft: true, data: { ...data, _status: 'draft' } })).resolves.toBeDefined()
  })
})
