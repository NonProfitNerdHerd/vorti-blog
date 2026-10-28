import { expect, it } from 'vitest'
import { publicDependencyInventory } from '@/publishing/dependencies'

it('finds declared relationships and JSON block dependencies without treating block IDs as content IDs', () => {
  const result = publicDependencyInventory({ featuredImage: 7, categories: [2], contentLayout: { nodes: [
    { id: 'image-block', kind: 'image', props: { mediaID: 7 } }, { kind: 'savedView', props: { viewID: '9' } },
    { type: 'upload', relationTo: 'media', value: 10 },
  ] } }, [{ name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true }])
  expect(result.references.map(ref => `${ref.collection}:${ref.id}`).sort()).toEqual(['categories:2', 'media:10', 'media:7', 'saved-views:9'])
  expect(result.problems).toEqual([])
})

it('blocks internal URLs, protected storage paths and audience-forged block queries', () => {
  const result = publicDependencyInventory({ links: ['/intranet/posts/private', 'https://example.invalid/sites/team/intranet/pages/private', '/api/publishing/media/1'],
    css: 'background:url("/__intranet__/private/image.png")', block: { where: { audience: { equals: 'intranet' } } }, ordinary: '/posts/public' })
  expect(result.problems).toHaveLength(5)
  expect(result.problems.join(' ')).not.toContain('ordinary')
})
