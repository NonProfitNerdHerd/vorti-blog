'use client'
import { publicAuthorIdentity } from '@design-system/payload-design-core/content'
import { RichText } from '@payloadcms/richtext-lexical/react'
import Image from 'next/image'
import type { Post } from '@/payload-types'
import { useCategoriesEnabled } from '@design-system/payload-design-core/content'
import { mediaURL } from '@/lib/media'
import { PostDesignSections } from './PostDesignSections'
import type { PostDesignSection } from '@/lib/post-design'
import {EventDetails} from '@/content-framework/EventDetails'
import { useSiteFormat, formatSiteDate } from '@design-system/payload-design-core/content'
import {savedViewConverters} from '@design-system/payload-design-core/content'

export function PostArticle({ post, designSections = [] }: { post: Post; designSections?: PostDesignSection[] }) {
  const siteFormat = useSiteFormat()
  const categoriesEnabled = useCategoriesEnabled()
  const image = mediaURL(post.featuredImage)
  const author = typeof post.author === 'object' ? publicAuthorIdentity(post.author) : ''
  return (
    <article className="container article">
      <header>
        <h1>{post.title || 'Untitled Post'}</h1>
        {post.publishedAt && <time dateTime={post.publishedAt}>{formatSiteDate(post.publishedAt, siteFormat)}</time>}
        {author && <p style={{ overflowWrap: 'anywhere' }}>By {author}</p>}
        {post.excerpt && <p className="lead">{post.excerpt}</p>}
        {categoriesEnabled && !!post.categories?.length && <p className="taxonomy">Categories: {post.categories.map((category) => typeof category === 'object' ? category.name : null).filter(Boolean).join(' · ')}</p>}
        {!!post.tags?.length && <p className="taxonomy">Tags: {post.tags.map((tag) => typeof tag === 'object' ? tag.name : null).filter(Boolean).join(' · ')}</p>}
      </header>
      <PostDesignSections sections={designSections} />
      <EventDetails post={post}/>
      {image && <Image unoptimized className="hero-image" src={image} width={1200} height={675} alt={typeof post.featuredImage === 'object' ? post.featuredImage?.alt || '' : ''} />}
      {!post.designTemplate && !('contentLayout' in post && post.contentLayout) && post.content?.root && <RichText data={post.content} converters={savedViewConverters} className="rich-text" />}
    </article>
  )
}
