import { formatSiteDate } from '@design-system/payload-design-core/content'
import { getPublicSiteDataSafe } from '@/lib/publicContent'
import Link from 'next/link'
import Image from 'next/image'
import type { Post } from '@/payload-types'
import { publicCategoriesEnabled } from '@/lib/public-categories'
import { mediaURL } from '@/lib/frontend'

export async function PostCard({ post }: { post: Post }) {
  const { siteSettings } = await getPublicSiteDataSafe()
  const categoriesEnabled = await publicCategoriesEnabled()
  const image = mediaURL(post.featuredImage)
  return (
    <article className="post-card">
      {image && <Link href={documentURL(post)}><Image unoptimized src={image} width={480} height={300} alt={typeof post.featuredImage === 'object' ? post.featuredImage?.alt || '' : ''} /></Link>}
      <div>
        <h2><Link href={documentURL(post)}>{post.title}</Link></h2>
        {post.publishedAt && <time dateTime={post.publishedAt}>{formatSiteDate(post.publishedAt, siteSettings)}</time>}
        {post.excerpt && <p>{post.excerpt}</p>}
        {categoriesEnabled && !!post.categories?.length && <p className="taxonomy">{post.categories.map((category) => typeof category === 'object' ? category.name : null).filter(Boolean).join(' · ')}</p>}
      </div>
    </article>
  )
}
import {documentURL} from '@design-system/payload-design-core'
