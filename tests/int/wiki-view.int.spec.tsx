import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { wikiLoginURL, wikiOutline, wikiView } from '../../src/knowledge/wiki-view'
import { KnowledgeRichText } from '../../src/knowledge/RichText'

const body = {
  root: {
    type: 'root',
    children: ['Overview', 'Overview', 'Overview 2', 'Café 日本語', ''].map((text, index) => ({
      type: 'heading',
      tag: `h${index + 2}`,
      children: [{ type: 'text', text }],
    })),
  },
}
it('renders stored heading levels with unique deterministic contents anchors', () => {
  const outline = wikiOutline(body)
  expect(outline.map((h) => h.level)).toEqual([2, 3, 4, 5, 6])
  expect(new Set(outline.map((h) => h.id)).size).toBe(5)
  expect(outline.map((h) => h.id)).toEqual(wikiOutline(structuredClone(body)).map((h) => h.id))
  const html = renderToStaticMarkup(<KnowledgeRichText body={body} />)
  for (const heading of outline) expect(html).toContain(`<h${heading.level} id="${heading.id}">`)
  expect(
    renderToStaticMarkup(<KnowledgeRichText body={body} anchorPrefix="revision-2-" />),
  ).toContain('id="revision-2-wiki-overview"')
})
it('does not collide with headings that already have numbered names', () => {
  const value = {
    root: {
      type: 'root',
      children: ['A', 'A 2', 'A', 'A 3', 'A'].map((text) => ({
        type: 'heading',
        children: [{ type: 'text', text }],
      })),
    },
  }
  expect(new Set(wikiOutline(value).map((h) => h.id)).size).toBe(5)
})
it('preserves valid views and legacy manage links', () => {
  expect(wikiView('history', '1')).toBe('history')
  expect(wikiView(undefined, '1')).toBe('edit')
  expect(wikiView('forged')).toBe('read')
})
it('uses only the shared login with a validated Wiki return path', () => {
  for (const path of ['/wiki/article/slug?view=edit', '/sites/team/wiki?view=history']) {
    const url = new URL(wikiLoginURL(path), 'https://example.invalid')
    expect(url.pathname).toBe('/admin/login')
    expect(url.searchParams.get('redirect')).toBe(path)
  }
  for (const path of [
    'https://evil.invalid/wiki',
    '//evil.invalid/wiki',
    '/\\evil.invalid/wiki',
    '/wiki%0dLocation:evil',
    '/admin',
    '/wiki%ZZ',
  ])
    expect(
      new URL(wikiLoginURL(path), 'https://example.invalid').searchParams.get('redirect'),
    ).toBe('/admin')
})
