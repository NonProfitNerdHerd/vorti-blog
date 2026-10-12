import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getAuthenticatedPreview, contentMetadata, getSiteSettings } from '@/lib/frontend'
import { resolvePostDesign } from '@/lib/post-design'
import { PostArticle } from '@/components/PostArticle'
import { LivePostPreview } from '@/components/LivePostPreview'
import { withPostType } from '@/content-framework/presentation'
import type { Post } from '@/payload-types'
export const dynamic = 'force-dynamic'
type Props = {
  params: Promise<{ slug: string; item: string }>
  searchParams: Promise<{ livePreview?: string }>
}
async function load(prefix: string, slug: string) {
  const payload = await getPayload({ config })
  const type = await payload.find({
    collection: 'post-types',
    where: { and: [{ prefix: { equals: prefix } }, { _status: { equals: 'published' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: false,
  })
  if (!type.docs[0]) return null
  const result = await payload.find({
    collection: 'posts',
    where: {
      and: [
        { slug: { equals: slug } },
        { postType: { equals: type.docs[0].id } },
        { _status: { equals: 'published' } },
      ],
    },
    limit: 1,
    depth: 2,
    overrideAccess: false,
  })
  return result.docs[0]
    ? ((await withPostType(
        payload,
        result.docs[0] as unknown as Record<string, unknown>,
      )) as unknown as Post)
    : null
}
export async function generateMetadata({ params, searchParams }: Props) {
  if ((await searchParams).livePreview) return { robots: { index: false, follow: false } }
  const { slug, item } = await params,
    post = await load(slug, item)
  return post ? contentMetadata(post, await getSiteSettings()) : {}
}
export default async function TypedPostPage({ params, searchParams }: Props) {
  const { slug, item } = await params,
    preview = (await searchParams).livePreview
  if (preview) {
    const post = await getAuthenticatedPreview('posts', preview)
    if (!post) notFound()
    return (
      <LivePostPreview initialData={post} initialDesignSections={await resolvePostDesign(post)} />
    )
  }
  const post = await load(slug, item)
  if (!post) notFound()
  return <PostArticle post={post} designSections={await resolvePostDesign(post)} />
}
