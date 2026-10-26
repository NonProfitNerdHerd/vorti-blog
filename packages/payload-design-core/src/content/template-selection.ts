import type { Template } from '../types'

/** The historical Hero Board seed is retained for existing content, not new articles. */
export const isSelectableArticleTemplate = (template: Pick<Template, 'slug'>): boolean =>
  template.slug !== 'standard-article'
