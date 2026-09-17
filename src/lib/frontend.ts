import type { Metadata } from 'next'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import config from '@/payload.config'
import type { Page, Post, SiteSetting } from '@/payload-types'
import { mediaURL } from './media'

export { mediaURL } from './media'

const payload = () => getPayload({ config })

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

export async function getAuthenticatedPreview(collection: 'posts', id: string): Promise<Post | null>
export async function getAuthenticatedPreview(collection: 'pages', id: string): Promise<Page | null>
export async function getAuthenticatedPreview(collection: 'posts' | 'pages', id: string): Promise<Page | Post | null> {
  const client = await payload()
  const { user } = await client.auth({ headers: await headers() })
  if (!user || user.collection !== 'users') return null
  if (id === 'new') return null
  const numericID = Number(id)
  if (!Number.isSafeInteger(numericID) || numericID < 1) return null
  try {
    if (collection === 'posts') {
      return await client.findByID({ collection, id: numericID, draft: true, depth: 2, overrideAccess: false, user })
    }
    return await client.findByID({ collection, id: numericID, draft: true, depth: 1, overrideAccess: false, user })
  } catch {
    return null
  }
}

export async function isAuthenticatedPreviewEditor(): Promise<boolean> {
  const { user } = await (await payload()).auth({ headers: await headers() })
  return Boolean(user && user.collection === 'users')
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
