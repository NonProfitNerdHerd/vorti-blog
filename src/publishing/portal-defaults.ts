import type { ContentLayout, SiteShellNode } from '@design-system/payload-design-core'

/** Ordinary shared blocks and Site Template elements; no separate portal editor. */
export function intranetTemplateDefaults() {
  const header: SiteShellNode[] = [{ id: 'intranet-header', type: 'layout', layout: 'row',
    style: { justification: 'space-between', alignment: 'center', gap: '1rem', padding: '1.25rem 0' }, children: [
      { id: 'intranet-brand', type: 'element', element: 'siteName', props: { source: 'siteSettings.siteName', linkToHomepage: true, htmlElement: 'span' }, style: { fontSize: '1.25rem' } },
      { id: 'intranet-label', type: 'element', element: 'text', props: { text: 'Intranet' } },
      { id: 'intranet-navigation', type: 'element', element: 'navigation', props: { menuSource: 'primary', orientation: 'horizontal' } },
      { id: 'intranet-search', type: 'element', element: 'search', props: { label: 'Search Intranet', placeholder: 'News and resources' } },
      { id: 'intranet-mobile-menu', type: 'element', element: 'mobileMenuToggle', props: { text: 'Menu' } },
    ] }]
  const footer: SiteShellNode[] = [{ id: 'intranet-footer', type: 'layout', layout: 'row',
    style: { justification: 'space-between', alignment: 'center', gap: '1rem', padding: '1.5rem 0' }, children: [
      { id: 'intranet-copyright', type: 'element', element: 'copyright', props: { tokens: ['copyright', 'currentYear', 'siteName'] } },
      { id: 'intranet-footer-navigation', type: 'element', element: 'navigation', props: { menuSource: 'footer', orientation: 'horizontal' } },
    ] }]
  return { name: 'Intranet', slug: 'intranet', description: 'Internal publishing shell. Edit its header, navigation, search and footer in the shared Site Template builder.',
    header: { layout: header, settings: { widthMode: 'contained', maxWidth: 1200, position: 'static', transparent: false, backgroundColor: '#0f3142', padding: '0 1rem' } },
    footer: { layout: footer, settings: { widthMode: 'contained', maxWidth: 1200, position: 'static', transparent: false, backgroundColor: '#0f3142', padding: '0 1rem' } },
    typography: { bodyFont: 'system-ui, sans-serif', headingFont: 'system-ui, sans-serif', baseFontSize: 16, lineHeight: 1.6, bodyWeight: '400', letterSpacing: 0 },
    colors: { background: '#f6f8fb', surface: '#ffffff', text: '#102a43', mutedText: '#526879', heading: '#102a43', primary: '#0f766e', secondary: '#164e63', accent: '#0d9488', border: '#dbe5eb', success: '#15803d', warning: '#a16207', error: '#b91c1c' },
    buttons: {}, dimensions: { contentWidth: 1200, wideWidth: 1200, fullWidth: 1440, pagePadding: '1rem', sectionSpacing: '2.5rem', contentSpacing: '1.5rem' },
    mobile: { breakpoint: 768, pagePadding: '1rem', sectionSpacing: '2rem', baseFontSize: 16, stackColumns: true, navigationMode: 'drawer' },
    additionalCSS: '', assignment: { mode: 'default', priority: 0 }, _status: 'published' as const }
}

export function intranetHomepageDefaults(siteName: string, homepageID: number): ContentLayout {
  return { version: 1, nodes: [
    { id: 'portal-welcome', kind: 'group', styles: { desktop: { backgroundColor: '#e7f3f2', padding: '2rem', borderRadius: '16px' }, mobile: { padding: '1rem' } }, children: [
      { id: 'portal-welcome-title', kind: 'heading', level: 2, text: `Welcome to ${siteName}` },
      { id: 'portal-welcome-description', kind: 'paragraph', text: 'Catch up on news and find the resources shared with you.' },
      { id: 'portal-quick-links', kind: 'row', children: [
        { id: 'portal-news-link', kind: 'button', text: 'Latest news', url: '/intranet/posts' },
        { id: 'portal-resources-link', kind: 'button', text: 'Resource directory', url: '/intranet/resources' },
      ] },
    ] },
    { id: 'portal-news-heading', kind: 'heading', level: 2, text: 'Latest news' },
    { id: 'portal-news', kind: 'postListing', props: { collection: 'posts', presentation: 'grid', limit: 6, sort: '-publishedAt', showImage: true, showTitle: true, showExcerpt: true, showDate: true, showLink: true } },
    { id: 'portal-resources-heading', kind: 'heading', level: 2, text: 'Resources' },
    { id: 'portal-resources', kind: 'postListing', props: { collection: 'pages', presentation: 'list', limit: 10, sort: 'title', excludeIDs: String(homepageID), showImage: false, showTitle: true, showExcerpt: false, showDate: false, showLink: true } },
  ] }
}
