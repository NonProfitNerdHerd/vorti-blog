import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LivePostPreview } from '@/components/LivePostPreview'
import { PostArticle } from '@/components/PostArticle'
import { contentMetadata, getAuthenticatedPreview, getPublishedPost, getSiteSettings, isAuthenticatedPreviewEditor } from '@/lib/frontend'
import type { Post } from '@/payload-types'
import { resolvePostDesign } from '@/lib/post-design'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ livePreview?: string }> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  if ((await searchParams).livePreview) return { robots: { index: false, follow: false } }
  const post = await getPublishedPost((await params).slug)
  return post ? contentMetadata(post, await getSiteSettings()) : {}
}

export default async function PostPage({ params, searchParams }: Props) {
  const previewID = (await searchParams).livePreview
  if (previewID) {
    const post = previewID === 'new'
      ? await isAuthenticatedPreviewEditor() ? emptyPost : null
      : await getAuthenticatedPreview('posts', previewID)
    if (!post) notFound()
    return <LivePostPreview initialData={post} initialDesignSections={await resolvePostDesign(post)} />
  }
  const post = await getPublishedPost((await params).slug)
  if (!post) notFound()
  return <PostArticle post={post} designSections={await resolvePostDesign(post)} />
}

const emptyPost: Post = {
  id: 0,
  title: '',
  slug: '',
  content: { root: { type: 'root', children: [], direction: null, format: '', indent: 0, version: 1 } },
  author: 0,
  updatedAt: '',
  createdAt: '',
  _status: 'draft',
}
