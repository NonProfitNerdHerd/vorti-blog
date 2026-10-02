import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Page } from '@/payload-types'
import type { PostDesignSection } from '@/lib/post-design'
import { PostDesignSections } from './PostDesignSections'

export function PageArticle({ page, designSections = [] }: { page: Page; designSections?: PostDesignSection[] }) {
  return <article className="container article"><h1>{page.title || 'Untitled Page'}</h1><PostDesignSections sections={designSections} />{!page.designTemplate && !('contentLayout' in page && page.contentLayout) && page.content?.root && <RichText data={page.content} className="rich-text" />}</article>
}
