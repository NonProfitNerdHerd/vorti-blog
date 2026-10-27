import { resolveMenu, legacyMenu } from '@/menus/server'
import { websiteReferences } from '@/organizations/website-fields'
import type { CollectionSlug } from 'payload'
import { publicSiteContext } from './public-site-context'
import { userIdentity } from '@design-system/payload-design-core'
import { getPayload } from 'payload'
import { cache } from 'react'
import config from '@/payload.config'
import type { Navigation, SiteSetting } from '@/payload-types'
import { CMS_MENU_RENDER, cmsSiteContext } from '@/organizations/cms-scope'
import { tenantAuthorityActive } from '@/organizations/tenant-runtime'

export const fallbackPublicSiteData = {
  navigation: { id: 0, primary: [], footer: [] } as Navigation,
  siteSettings: { id: 0, siteName: 'VortiCause' } as SiteSetting,
}

export const getPublicSiteData = cache(async () => {
  const payload = await getPayload({ config })
  const selected = await publicSiteContext()
  if (selected.website) {
    const db = (payload.db as unknown as { client: D1Database }).client
    const scoped = await tenantAuthorityActive(db, selected.site)
    const settings = scoped
      ? await payload.findGlobal({
          slug: 'site-settings',
          context: selected.context,
          user: selected.user || null,
          overrideAccess: false,
          depth: 1,
        })
      : JSON.parse(selected.website.presentation)
    for (const [key, collection] of Object.entries(websiteReferences)) {
      if (!settings[key] || (typeof settings[key] === 'object' && settings[key] !== null)) continue
      try {
        settings[key] = await payload.findByID({
          collection: collection as CollectionSlug,
          id: settings[key],
          context: selected.context,
          user: selected.user || null,
          overrideAccess: false,
          depth: 1,
        })
      } catch {
        settings[key] = null
      }
    }
    const navigation = scoped
      ? { primaryMenu: settings.primaryMenu, footerMenu: settings.footerMenu }
      : JSON.parse(selected.website.navigation)
    for (const slot of ['primary', 'footer']) {
      if (navigation[slot + 'Menu']) {
        const reference = navigation[slot + 'Menu']
        const menu = await resolveMenu(
          payload,
          typeof reference === 'object' ? reference.id : reference,
          selected.site,
        )
        navigation[slot] = menu ? legacyMenu(menu.items) : []
      }
    }
    return {
      navigation: { id: 0, ...navigation } as Navigation,
      siteSettings: {
        id: 0,
        ...settings,
        siteName: settings.siteName || selected.website.name,
      } as SiteSetting,
    }
  }
  const db = (payload.db as unknown as { client: D1Database }).client
  if (await tenantAuthorityActive(db, 'default')) {
    const siteSettings = await payload.findGlobal({
      slug: 'site-settings',
      depth: 1,
      overrideAccess: false,
    })
    const settings = siteSettings as unknown as Record<string, unknown>
    const navigation = { id: 0, primary: [], footer: [] } as Navigation
    for (const slot of ['primary', 'footer'] as const) {
      const reference = settings[slot + 'Menu']
      const id =
        typeof reference === 'object' && reference ? (reference as { id: number }).id : reference
      if (id) {
        const menu = await resolveMenu(payload, Number(id), 'default')
        Object.assign(navigation, { [slot]: menu ? legacyMenu(menu.items) : [] })
      }
    }
    return { navigation, siteSettings }
  }
  const [navigation, siteSettings] = await Promise.all([
    payload.findGlobal({
      slug: 'navigation',
      depth: 1,
      overrideAccess: false,
      context: { ...cmsSiteContext('default'), [CMS_MENU_RENDER]: true },
    }),
    payload.findGlobal({ slug: 'site-settings', depth: 1, overrideAccess: false }),
  ])
  return { navigation, siteSettings }
})

export const getPublicSiteDataSafe = cache(async () => {
  try {
    return await getPublicSiteData()
  } catch (error) {
    if ((await publicSiteContext()).site !== 'default') throw error
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
      username: true,
      email: true,
      attributionPreference: true,
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
  if (!author || !userIdentity(author, author.displayName || '') || !author.slug) return null

  const photo = author.profilePhoto
  return {
    displayName: userIdentity(author, author.displayName || ''),
    slug: author.slug,
    profilePhoto: photo && typeof photo === 'object' ? { url: photo.url, alt: photo.alt } : null,
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
