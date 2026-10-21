/** Frozen mapping used by the additive ownership migration and runtime guards. */
export const cmsCollections: ReadonlyArray<readonly [string, string, string | null]> = [
  ['posts', 'posts', '_posts_v'],
  ['pages', 'pages', '_pages_v'],
  ['categories', 'categories', null],
  ['tags', 'tags', null],
  ['media', 'media', null],
  ['site-templates', 'site_tpl', '_site_tpl_v'],
  ['menus', 'menus', null],
  ['saved-views', 'saved_views', '_saved_views_v'],
  ['event-series', 'event_series', null],
  ['design-block-types', 'design_block_types', '_design_block_types_v'],
  ['design-block-designs', 'design_block_designs', '_design_block_designs_v'],
  ['design-templates', 'design_templates', '_design_templates_v'],
  ['search', 'search', null],
  ['redirects', 'redirects', null],
  ['exports', 'exports', null],
  ['imports', 'imports', null],
] as const
export const scopedCMS = new Set<string>(cmsCollections.map(([slug]) => slug))
export const designCMS = new Set([
  'site-templates',
  'design-block-types',
  'design-block-designs',
  'design-templates',
  'saved-views',
])
