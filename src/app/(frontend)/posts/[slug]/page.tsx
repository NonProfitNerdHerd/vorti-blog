import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { contentMetadata, getPublishedPost, getSiteSettings, mediaURL } from '@/lib/frontend'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) return {}
  return contentMetadata(post, await getSiteSettings())
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) notFound()
  const image = mediaURL(post.featuredImage)
  const author = typeof post.author === 'object' && post.author.profilePublic ? post.author : null
  return (
    <article className="container article">
      <header>
        <h1>{post.title}</h1>
        {post.publishedAt && <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</time>}
        {author?.displayName && <p>By {author.displayName}</p>}
        {post.excerpt && <p className="lead">{post.excerpt}</p>}
        {!!post.categories?.length && <p className="taxonomy">Categories: {post.categories.map((category) => typeof category === 'object' ? category.name : null).filter(Boolean).join(' · ')}</p>}
        {!!post.tags?.length && <p className="taxonomy">Tags: {post.tags.map((tag) => typeof tag === 'object' ? tag.name : null).filter(Boolean).join(' · ')}</p>}
      </header>
      {image && <Image unoptimized className="hero-image" src={image} width={1200} height={675} alt={typeof post.featuredImage === 'object' ? post.featuredImage?.alt || '' : ''} />}
      <RichText data={post.content} className="rich-text" />
    </article>
  )
}
