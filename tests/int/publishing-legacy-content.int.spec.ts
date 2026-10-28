import { expect, it } from 'vitest'
import { emptyKnowledgeBody } from '@/knowledge/content'
import { convertLegacyBody, orderLegacyIntranet, prepareLegacyPage, type LegacyIntranetRow } from '@/publishing/legacy-content'

const body = (text: string) => JSON.stringify({ root: { ...emptyKnowledgeBody.root, children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text, format: 3, mode: 'normal', detail: 0 }], direction: null, format: '', indent: 0 }] } })
const row = (id: string, parent: string | null = null): LegacyIntranetRow => ({ id, parent_id: parent, tenant_id: 'default', site_id: 'default', kind: 'intranet', title: 'Newer draft', slug: id,
  body: body('Draft body'), published_title: 'Published title', published_body: body('Published body'), revision: 3, deleted: 0, creator_id: 7, updated_at: '2026-10-27T00:00:00.000Z' })

it('preserves independent published and draft bodies, formatting, ownership and immutable history', async () => {
  const source = row('home'), original = JSON.stringify(source)
  const versions = [{ id: 'original', page_id: 'home', revision: 1, title: 'Original', body: body('Historical body'), actor_id: 9, action: 'published', created_at: source.updated_at }]
  const result = await prepareLegacyPage(source, versions)
  expect(result.title).toBe('Published title')
  expect(result.content).toEqual(JSON.parse(source.published_body!))
  expect(result.draftContent).toEqual(JSON.parse(source.body))
  expect(result.hasUnpublishedChanges).toBe(true)
  expect(result.owner).toBe(7)
  expect(result.versions).toEqual(versions)
  expect(JSON.stringify(source)).toBe(original)
  expect((await prepareLegacyPage(source, versions)).sourceHash).toBe(result.sourceHash)
})

it('converts legacy links to stable shared-editor links without dropping their text or URL', async () => {
  const original = { root: { ...emptyKnowledgeBody.root, children: [{ type: 'link', version: 1, url: '/intranet/old-link', target: '_blank', children: [{ type: 'text', version: 1, text: 'Old resource', format: 0 }] }] } }
  const converted = await convertLegacyBody(JSON.stringify(original))
  const link = (converted.root.children as Array<Record<string, unknown>>)[0]
  expect(link.fields).toEqual({ url: '/intranet/old-link', linkType: 'custom', newTab: true })
  expect(link.children).toEqual(original.root.children[0].children)
  expect(link.id).toMatch(/^[a-f0-9]{24}$/)
  expect(await convertLegacyBody(JSON.stringify(original))).toEqual(converted)
})

it('retains deleted and unpublished records as archived drafts rather than publishing them', async () => {
  const result = await prepareLegacyPage({ ...row('deleted'), deleted: 1, published_title: null, published_body: null }, [])
  expect(result.archived).toBe(true)
  expect(result.status).toBe('draft')
})

it('orders parents before children and rejects cycles, missing parents and foreign scopes', () => {
  expect(orderLegacyIntranet([row('a-child', 'z-parent'), row('z-parent')]).map(item => item.id)).toEqual(['z-parent', 'a-child'])
  expect(() => orderLegacyIntranet([row('one', 'two'), row('two', 'one')])).toThrow('cycle')
  expect(() => orderLegacyIntranet([row('one', 'missing')])).toThrow('missing')
  expect(() => orderLegacyIntranet([row('one', 'two'), { ...row('two'), site_id: 'foreign' }])).toThrow('another scope')
  const chain = Array.from({ length: 65 }, (_, index) => row(String(index).padStart(3, '0'), index ? String(index - 1).padStart(3, '0') : null))
  expect(() => orderLegacyIntranet(chain)).toThrow('depth')
})

it('blocks unsupported or incomplete conversion instead of silently removing content', async () => {
  await expect(prepareLegacyPage({ ...row('bad'), body: JSON.stringify({ root: { type: 'unknown-node', children: [] } }) }, [])).rejects.toThrow('Unsupported')
  await expect(prepareLegacyPage({ ...row('bad'), published_title: null }, [])).rejects.toThrow('incomplete')
})
