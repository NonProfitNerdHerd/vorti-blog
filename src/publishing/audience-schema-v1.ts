/** Frozen ownership map used by the additive compatibility migration. */
export const audienceTablesV1: ReadonlyArray<readonly [string, string, string | null]> = [
  ['posts', 'posts', '_posts_v'],
  ['pages', 'pages', '_pages_v'],
  ['site-templates', 'site_tpl', '_site_tpl_v'],
  ['media', 'media', null],
  ['categories', 'categories', null],
  ['tags', 'tags', null],
  ['saved-views', 'saved_views', '_saved_views_v'],
  ['menus', 'menus', null],
  ['search', 'search', null],
  ['event-series', 'event_series', null],
  ['redirects', 'redirects', null],
  ['imports', 'imports', null],
  ['exports', 'exports', null],
]
