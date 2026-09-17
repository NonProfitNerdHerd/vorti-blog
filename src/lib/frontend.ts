import type { Metadata } from 'next'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Media, Page, Post, SiteSetting } from '@/payload-types'

const payload = () => getPayload({ config })

export function mediaURL(value: number | Media | null | undefined): string | null {
  return value && typeof value === 'object' ? value.url || null : null
}

export async function getPublishedPage(slug: string): Promise<Page | null> {
  const result = await (await payload()).find({
    collection: 'pages',
    where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
    depth: 1, limit: 1, draft: false, overrideAccess: false,
  })
  return result.docs[0] ?? null
}

export async function getPublishedPost(slug: string): Promise<Post | null> {
  const result = await (await payload()).find({
    collection: 'posts',
    where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
    depth: 2, limit: 1, draft: false, overrideAccess: false,
  })
  return result.docs[0] ?? null
}

export async function getPublishedPosts(page = 1, limit = 10) {
  return (await payload()).find({
    collection: 'posts', where: { _status: { equals: 'published' } },
    depth: 1, limit, page, sort: '-publishedAt', draft: false, overrideAccess: false,
  })
}

export async function getSiteSettings(): Promise<SiteSetting> {
  return (await payload()).findGlobal({ slug: 'site-settings', depth: 1, overrideAccess: false })
}

export function contentMetadata(doc: Page | Post, site: SiteSetting): Metadata {
  const title = doc.meta?.title || `${doc.title} | ${site.siteName || 'Vorti Blog'}`
  const description = doc.meta?.description || ('excerpt' in doc ? doc.excerpt : null) || site.defaultSeoDescription || site.siteDescription || undefined
  const image = mediaURL(doc.meta?.image) || mediaURL(site.defaultSocialImage)
  return { title, description, openGraph: { title, description, images: image ? [{ url: image }] : undefined } }
}
