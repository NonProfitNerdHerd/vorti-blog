import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PublicSiteProvider, SiteAnchor, sitePath } from './PublicSiteContext'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { savedViewConverters } from './views/RichView'

describe('child website destinations', () => {
  it('keeps main-site links unchanged and scopes child pages, API calls, and media', () => {
    expect(sitePath('', '/posts/example')).toBe('/posts/example')
    for (const path of [
      '/',
      '/posts/example',
      '/api/forms-runtime/example',
      '/api/media/file/brand.png',
    ])
      expect(sitePath('/sites/region', path)).toBe('/sites/region' + path)
    expect(sitePath('/sites/region', '/sites/local/posts/example')).toBe(
      '/sites/local/posts/example',
    )
  })
  it('preserves explicit external destinations and shared static assets', () => {
    for (const path of [
      'https://example.org',
      'mailto:contact@example.invalid',
      '#section',
      '/_next/static/example.js',
      '/forms-assets/runtime.js',
    ])
      expect(sitePath('/sites/region', path)).toBe(path)
  })
  it('carries authenticated previews through internal links before their fragment', () => {
    const html = renderToStaticMarkup(
      <PublicSiteProvider prefix="/sites/region" preview>
        <SiteAnchor href="/posts/example?x=1#section">Open</SiteAnchor>
      </PublicSiteProvider>,
    )
    expect(html).toContain('/sites/region/posts/example?x=1&amp;preview=1#section')
  })
  it('scopes rich-text page and document links while preserving external links', () => {
    const links = [
      { linkType: 'custom', url: '/about' },
      { linkType: 'internal', doc: { relationTo: 'posts', value: { id: 1, slug: 'news' } } },
      { linkType: 'custom', url: 'https://example.org' },
    ].map((fields) => ({
      type: 'link',
      version: 3,
      fields,
      children: [
        { type: 'text', version: 1, text: 'Open', format: 0, detail: 0, mode: 'normal', style: '' },
      ],
    }))
    const data = {
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: 'ltr',
        children: [{ type: 'paragraph', version: 1, children: links }],
      },
    }
    const html = renderToStaticMarkup(
      <PublicSiteProvider prefix="/sites/region">
        <RichText data={data as never} converters={savedViewConverters} />
      </PublicSiteProvider>,
    )
    expect(html).toContain('href="/sites/region/about"')
    expect(html).toContain('href="/sites/region/posts/news"')
    expect(html).toContain('href="https://example.org"')
  })
})
