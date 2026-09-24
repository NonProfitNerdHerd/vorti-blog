import { getPayload } from 'payload'
import { cache } from 'react'
import config from '@/payload.config'
import type { Navigation, SiteSetting } from '@/payload-types'

export const fallbackPublicSiteData = {
  navigation: { id: 0, primary: [], footer: [] } as Navigation,
  siteSettings: { id: 0, siteName: 'Vorti Blog' } as SiteSetting,
}

export const getPublicSiteData = cache(async () => {
  const payload = await getPayload({ config })
  const [navigation, siteSettings] = await Promise.all([
    payload.findGlobal({ slug: 'navigation', depth: 1, overrideAccess: false }),
    payload.findGlobal({ slug: 'site-settings', depth: 1, overrideAccess: false }),
  ])
  return { navigation, siteSettings }
})

export const getPublicSiteDataSafe = cache(async () => {
  try {
    return await getPublicSiteData()
  } catch {
    return fallbackPublicSiteData
  }
})

export async function getPublicAuthorProfile(slug: string) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'users',
    where: {
      and: [{ slug: { equals: slug } }, { profilePublic: { equals: true } }],
    },
    depth: 1,
    limit: 1,
    overrideAccess: true,
    select: {
      displayName: true,
      slug: true,
      profilePhoto: true,
      shortBio: true,
      biography: true,
      website: true,
      twitterURL: true,
      youtubeURL: true,
      facebookURL: true,
      instagramURL: true,
      githubURL: true,
    },
  })
  const author = result.docs[0]
  if (!author?.displayName || !author.slug) return null

  const photo = author.profilePhoto
  return {
    displayName: author.displayName,
    slug: author.slug,
    profilePhoto:
      photo && typeof photo === 'object' ? { url: photo.url, alt: photo.alt } : null,
    shortBio: author.shortBio ?? null,
    biography: author.biography ?? null,
    website: author.website ?? null,
    twitterURL: author.twitterURL ?? null,
    youtubeURL: author.youtubeURL ?? null,
    facebookURL: author.facebookURL ?? null,
    instagramURL: author.instagramURL ?? null,
    githubURL: author.githubURL ?? null,
  }
}
