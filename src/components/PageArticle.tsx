import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Page } from '@/payload-types'

export function PageArticle({ page }: { page: Page }) {
  return <article className="container article"><h1>{page.title || 'Untitled Page'}</h1>{page.content?.root && <RichText data={page.content} className="rich-text" />}</article>
}
