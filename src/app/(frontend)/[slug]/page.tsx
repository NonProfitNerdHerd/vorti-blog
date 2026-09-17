import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LivePagePreview } from '@/components/LivePagePreview'
import { PageArticle } from '@/components/PageArticle'
import { contentMetadata, getAuthenticatedPreview, getPublishedPage, getSiteSettings, isAuthenticatedPreviewEditor } from '@/lib/frontend'
import type { Page } from '@/payload-types'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ livePreview?: string }> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  if ((await searchParams).livePreview) return { robots: { index: false, follow: false } }
  const page = await getPublishedPage((await params).slug)
  return page ? contentMetadata(page, await getSiteSettings()) : {}
}

export default async function PageDetail({ params, searchParams }: Props) {
  const previewID = (await searchParams).livePreview
  if (previewID) {
    const page = previewID === 'new'
      ? await isAuthenticatedPreviewEditor() ? emptyPage : null
      : await getAuthenticatedPreview('pages', previewID)
    if (!page) notFound()
    return <LivePagePreview initialData={page} />
  }
  const page = await getPublishedPage((await params).slug)
  if (!page) notFound()
  return <PageArticle page={page} />
}

const emptyPage: Page = {
  id: 0,
  title: '',
  slug: '',
  content: { root: { type: 'root', children: [], direction: null, format: '', indent: 0, version: 1 } },
  updatedAt: '',
  createdAt: '',
  _status: 'draft',
}
