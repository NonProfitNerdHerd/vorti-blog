import { expect, it } from 'vitest'
import { internalPagePath } from '@/publishing/paths'

it('retains hierarchical paths and keeps legacy mapping redirects on the current site', () => {
  expect(internalPagePath({ slug: 'child', breadcrumbs: [{ url: '/parent' }, { url: '/parent/child' }] })).toBe('/parent/child')
  for (const url of ['https://example.invalid/private', '//example.invalid/private', '/\\example.invalid', '/%2fexample.invalid', '/page?redirect=other', '/page\nother'])
    expect(internalPagePath({ slug: 'safe page', breadcrumbs: [{ url }] })).toBe('/safe%20page')
})
