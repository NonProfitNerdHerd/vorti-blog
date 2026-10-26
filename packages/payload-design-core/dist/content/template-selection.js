/** The historical Hero Board seed is retained for existing content, not new articles. */
export const isSelectableArticleTemplate = (template) => template.slug !== 'standard-article';
