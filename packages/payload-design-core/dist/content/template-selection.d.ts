import type { Template } from '../types';
/** The historical Hero Board seed is retained for existing content, not new articles. */
export declare const isSelectableArticleTemplate: (template: Pick<Template, "slug">) => boolean;
