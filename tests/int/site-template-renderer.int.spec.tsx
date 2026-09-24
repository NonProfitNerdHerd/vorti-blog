import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Navigation, SiteSetting, SiteTemplate } from '@/payload-types'
import { resolveSiteShellFromLoaders, selectPublishedSiteTemplate } from '@/lib/siteTemplate'
import { compileSiteTemplateCSS, SiteTemplateFooter, SiteTemplateHeader, SiteTemplateStyles } from '@/components/site-shell/SiteTemplateShell'

const settings = { id: 1, siteName: 'Rendered Site', twitterURL: 'https://example.com/social', logo: { id: 2, url: '/media/logo.png', alt: 'Rendered Site logo' } } as SiteSetting
const navigation = { id: 1, primary: [{ label: 'About', linkType: 'internal', page: { id: 7, slug: 'about', title: 'About', _status: 'published' }, enabled: true }, { label: 'External', linkType: 'external', url: 'https://example.com', newTab: true, enabled: true }], footer: [] } as Navigation
const template = {
  id: 4, name: 'Public Shell', slug: 'public-shell', _status: 'published',
  header: { layout: [{ id: 'header-row', type: 'layout', layout: 'row', children: [{ id: 'logo', type: 'element', element: 'logo' }, { id: 'name', type: 'element', element: 'siteName', props: { linkToHomepage: true } }, { id: 'menu', type: 'element', element: 'navigation', props: { menuSource: 'primary' } }, { id: 'toggle', type: 'element', element: 'mobileMenuToggle' }, { id: 'cta', type: 'element', element: 'button', props: { label: 'Join', url: '/join', buttonStyle: 'secondary' } }] }], settings: { widthMode: 'contained', maxWidth: 1100, position: 'sticky' } },
  footer: { layout: [{ id: 'footer-stack', type: 'layout', layout: 'stack', children: [{ id: 'copyright', type: 'element', element: 'copyright' }, { id: 'social', type: 'element', element: 'socialLinks', props: { networks: ['twitter'], showLabels: true } }] }], settings: { widthMode: 'full' } },
  typography: { bodyFont: 'system-ui' }, colors: { brand: '#123456' }, dimensions: { contentWidth: '70rem' }, mobile: { breakpoint: 720 },
  additionalCSS: '.site-template-header{color:rebeccapurple}', assignment: { mode: 'default', priority: 0 }, updatedAt: '', createdAt: '',
} as unknown as SiteTemplate

describe('public Site Template resolution and rendering', () => {
  it('selects only a published, valid shell', () => {
    expect(selectPublishedSiteTemplate(settings, navigation, template).kind).toBe('template')
    expect(selectPublishedSiteTemplate(settings, navigation, null).kind).toBe('legacy')
    expect(selectPublishedSiteTemplate(settings, navigation, { ...template, _status: 'draft' }).kind).toBe('legacy')
    expect(selectPublishedSiteTemplate(settings, navigation, { ...template, header: { layout: [{ type: 'element', element: 'siteName' }] } } as SiteTemplate).kind).toBe('legacy')
  })

  it('falls back for null, missing, draft, invalid, and failed template loads', async () => {
    const globals = async () => ({ siteSettings: { ...settings, defaultSiteTemplate: 4 }, navigation })
    expect((await resolveSiteShellFromLoaders(async () => ({ siteSettings: { ...settings, defaultSiteTemplate: null }, navigation }), async () => template)).kind).toBe('legacy')
    expect((await resolveSiteShellFromLoaders(globals, async () => null)).kind).toBe('legacy')
    expect((await resolveSiteShellFromLoaders(globals, async () => ({ ...template, _status: 'draft' }))).kind).toBe('legacy')
    expect((await resolveSiteShellFromLoaders(globals, async () => ({ ...template, footer: { layout: [{ type: 'bad' }] } } as SiteTemplate))).kind).toBe('legacy')
    expect((await resolveSiteShellFromLoaders(globals, async () => { throw new Error('missing table') })).kind).toBe('legacy')
  })

  it('keeps routes usable when Site Settings or Navigation loading fails', async () => {
    const result = await resolveSiteShellFromLoaders(async () => { throw new Error('globals unavailable') }, async () => template)
    expect(result.kind).toBe('legacy')
    expect(result.siteSettings.siteName).toBe('Vorti Blog')
    expect(result.navigation.primary).toEqual([])
    expect(renderToStaticMarkup(<SiteTemplateHeader template={template} siteSettings={settings} navigation={{ ...navigation, primary: [] }} header={template.header.layout as never} footer={template.footer.layout as never} />)).toContain('Rendered Site')
  })

  it('renders nested shell elements and existing Navigation data', () => {
    const resolution = selectPublishedSiteTemplate(settings, navigation, template)
    if (resolution.kind !== 'template') throw new Error('Expected template')
    const header = renderToStaticMarkup(<SiteTemplateHeader {...resolution} />)
    const footer = renderToStaticMarkup(<SiteTemplateFooter {...resolution} />)
    expect(header).toContain('Rendered Site')
    expect(header).toContain('/media/logo.png')
    expect(header).toContain('href="/about"')
    expect(header).toContain('site-shell-button--secondary')
    expect(header).toContain('aria-expanded="false"')
    expect(footer).toContain('Rendered Site')
    expect(footer).toContain('https://example.com/social')
  })

  it('emits generated tokens before validated Additional CSS', () => {
    const css = compileSiteTemplateCSS(template)
    const markup = renderToStaticMarkup(<SiteTemplateStyles template={template} />)
    expect(css).toContain('--site-color-brand:#123456')
    expect(css).toContain('@media(max-width:720px)')
    expect(markup.indexOf('data-site-template="generated"')).toBeLessThan(markup.indexOf('data-site-template="additional"'))
  })

  it('omits unsupported and unsafe optional element configuration', () => {
    const unsafe = { ...template, header: { layout: [{ id: 'bad-button', type: 'element', element: 'button', props: { label: 'Bad', url: 'javascript:alert(1)' } }, { id: 'search', type: 'element', element: 'search' }] } } as unknown as SiteTemplate
    const resolution = selectPublishedSiteTemplate(settings, navigation, unsafe)
    if (resolution.kind !== 'template') throw new Error('Expected template')
    const markup = renderToStaticMarkup(<SiteTemplateHeader {...resolution} />)
    expect(markup).not.toContain('javascript:')
    expect(markup).not.toContain('Bad')
  })
})
