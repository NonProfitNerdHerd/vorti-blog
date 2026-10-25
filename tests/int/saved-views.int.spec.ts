import { createChapterUser } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { defaultView } from '@design-system/payload-design-core'
import { queryView, readSavedView } from '@/content-framework/query'

/** Shared Saved View coverage retained independently of the retired registry. */
describe('Saved View publication and Page queries', () => {
  let payload: Payload, req: PayloadRequest
  const stamp = Date.now()
  beforeAll(async () => {
    payload = await getPayload({ config })
    const user = await createChapterUser(payload, 'administrator', { collection: 'users', data: { username: `views-${stamp}`, email: `views-${stamp}@example.invalid`, password: 'local-view-check', role: 'administrator' } })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  })
  it('isolates drafts and protects definitions referenced by published Pages', async () => {
    const view = await payload.create({ collection: 'saved-views', req, data: { name: 'Reusable view', configuration: defaultView, _status: 'published' } })
    await payload.create({ collection: 'pages', req, data: { title: 'Published placement', slug: `view-placement-${stamp}`, _status: 'published', contentLayout: { version: 1, nodes: [{ id: 'placement', kind: 'savedView', props: { viewID: String(view.id) } }] } } })
    await payload.update({ collection: 'saved-views', id: view.id, req, draft: true, data: { configuration: { ...defaultView, layout: 'grid-2' }, _status: 'draft' } })
    expect((await readSavedView(payload, String(view.id))).layout).toBe('grid-1')
    expect((await readSavedView(payload, String(view.id), { user: req.user, draft: true })).layout).toBe('grid-2')
    await expect(payload.delete({ collection: 'saved-views', id: view.id, req })).rejects.toThrow('used by published content')
  })
  it('rejects unsafe designs and unpublished placements', async () => {
    await expect(payload.create({ collection: 'saved-views', req, data: { name: 'Unsafe', configuration: { ...defaultView, design: { presentation: { css: 'body { display:none }' } } }, _status: 'published' } })).rejects.toThrow()
    const draft = await payload.create({ collection: 'saved-views', req, data: { name: 'Unpublished view', configuration: defaultView, _status: 'draft' } })
    await expect(payload.create({ collection: 'pages', req, data: { title: 'Invalid placement', slug: `invalid-placement-${stamp}`, _status: 'published', contentLayout: { version: 1, nodes: [{ id: 'draft-view', kind: 'savedView', props: { viewID: String(draft.id) } }] } } })).rejects.toThrow('Publish the referenced Saved View')
  })
  it('orders selected Pages before pagination', async () => {
    const ids: string[] = []
    for (let index = 0; index < 3; index++) ids.push(String((await payload.create({ collection: 'pages', req, data: { title: `Ordered ${index}`, slug: `ordered-${stamp}-${index}`, _status: 'published' } })).id))
    const result = await queryView(payload, { ...defaultView, query: { source: 'pages', ids: [ids[2], ids[0], ids[1]], sort: 'manual', limit: 1 } }, new URLSearchParams({ page: '2' }))
    expect(result.items.map(item => item.id)).toEqual([ids[0]])
    expect(result.totalPages).toBe(3)
  })
  it('denies anonymous definition writes and private event-index reads', async () => {
    await expect(payload.create({ collection: 'saved-views', overrideAccess: false, data: { name: 'Denied', configuration: defaultView } })).rejects.toThrow()
    await expect(payload.find({ collection: 'event-series', overrideAccess: false })).rejects.toThrow()
  })
})
