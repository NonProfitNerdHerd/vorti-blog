import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { contentMetadata, getPublishedPage, getSiteSettings } from '@/lib/frontend'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await getPublishedPage(slug)
  if (!page) return {}
  return contentMetadata(page, await getSiteSettings())
}

export default async function PageDetail({ params }: Props) {
  const { slug } = await params
  const page = await getPublishedPage(slug)
  if (!page) notFound()
  return <article className="container article"><h1>{page.title}</h1><RichText data={page.content} className="rich-text" /></article>
}
