import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Page } from '@/payload-types'
import type { PostDesignSection } from '@/lib/post-design'
import { PostDesignSections } from './PostDesignSections'
import {savedViewConverters} from '@design-system/payload-design-core/content'

export function PageArticle({ page, designSections = [] }: { page: Page; designSections?: PostDesignSection[] }) {
  return <article className="container article"><h1>{page.title || 'Untitled Page'}</h1><PostDesignSections sections={designSections} />{!page.designTemplate && !('contentLayout' in page && page.contentLayout) && page.content?.root && <RichText data={page.content} converters={savedViewConverters} className="rich-text" />}</article>
}
