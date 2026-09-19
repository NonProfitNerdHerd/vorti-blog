import { RichText } from '@payloadcms/richtext-lexical/react'
import Image from 'next/image'
import type { Post } from '@/payload-types'
import { mediaURL } from '@/lib/media'
import { PostDesignSections } from './PostDesignSections'
import type { PostDesignSection } from '@/lib/post-design'

export function PostArticle({ post, designSections = [] }: { post: Post; designSections?: PostDesignSection[] }) {
  const image = mediaURL(post.featuredImage)
  const author = typeof post.author === 'object' && post.author?.profilePublic ? post.author : null
  return (
    <article className="container article">
      <header>
        <h1>{post.title || 'Untitled Post'}</h1>
        {post.publishedAt && <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</time>}
        {author?.displayName && <p>By {author.displayName}</p>}
        {post.excerpt && <p className="lead">{post.excerpt}</p>}
        {!!post.categories?.length && <p className="taxonomy">Categories: {post.categories.map((category) => typeof category === 'object' ? category.name : null).filter(Boolean).join(' · ')}</p>}
        {!!post.tags?.length && <p className="taxonomy">Tags: {post.tags.map((tag) => typeof tag === 'object' ? tag.name : null).filter(Boolean).join(' · ')}</p>}
      </header>
      <PostDesignSections sections={designSections} />
      {image && <Image unoptimized className="hero-image" src={image} width={1200} height={675} alt={typeof post.featuredImage === 'object' ? post.featuredImage?.alt || '' : ''} />}
      {post.content?.root && <RichText data={post.content} className="rich-text" />}
    </article>
  )
}
