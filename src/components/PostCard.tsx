import Link from 'next/link'
import Image from 'next/image'
import type { Post } from '@/payload-types'
import { mediaURL } from '@/lib/frontend'

export function PostCard({ post }: { post: Post }) {
  const image = mediaURL(post.featuredImage)
  return (
    <article className="post-card">
      {image && <Link href={`/posts/${post.slug}`}><Image unoptimized src={image} width={480} height={300} alt={typeof post.featuredImage === 'object' ? post.featuredImage?.alt || '' : ''} /></Link>}
      <div>
        <h2><Link href={`/posts/${post.slug}`}>{post.title}</Link></h2>
        {post.publishedAt && <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</time>}
        {post.excerpt && <p>{post.excerpt}</p>}
        {!!post.categories?.length && <p className="taxonomy">{post.categories.map((category) => typeof category === 'object' ? category.name : null).filter(Boolean).join(' · ')}</p>}
      </div>
    </article>
  )
}
