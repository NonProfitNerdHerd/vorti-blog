import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Navigation, SiteSetting, SiteTemplate } from '@/payload-types'
import { getPublicSiteData } from '@/lib/publicContent'
import { validateAdditionalCSS, validateSiteShellNodes, type SiteShellNode } from '@design-system/payload-design-core'

export type ResolvedSiteShell =
  | { kind: 'legacy'; navigation: Navigation; siteSettings: SiteSetting }
  | { kind: 'template'; navigation: Navigation; siteSettings: SiteSetting; template: SiteTemplate; header: SiteShellNode[]; footer: SiteShellNode[] }

export function selectPublishedSiteTemplate(siteSettings: SiteSetting, navigation: Navigation, candidate: SiteTemplate | null): ResolvedSiteShell {
  if (!candidate || candidate._status !== 'published') return { kind: 'legacy', navigation, siteSettings }
  if (validateSiteShellNodes(candidate.header?.layout) !== true || validateSiteShellNodes(candidate.footer?.layout) !== true) return { kind: 'legacy', navigation, siteSettings }
  if (validateAdditionalCSS(candidate.additionalCSS) !== true) return { kind: 'legacy', navigation, siteSettings }
  return { kind: 'template', navigation, siteSettings, template: candidate, header: candidate.header.layout as SiteShellNode[], footer: candidate.footer.layout as SiteShellNode[] }
}

export const resolvePublicSiteShell = cache(async (): Promise<ResolvedSiteShell> => {
  const payload = await getPayload({ config })
  const { navigation, siteSettings } = await getPublicSiteData()
  const selected = siteSettings.defaultSiteTemplate
  const id = typeof selected === 'object' && selected ? selected.id : selected
  if (id == null) return { kind: 'legacy', navigation, siteSettings }
  try {
    const result = await payload.find({ collection: 'site-templates', depth: 2, limit: 1, overrideAccess: false, where: { and: [{ id: { equals: id } }, { _status: { equals: 'published' } }] } })
    return selectPublishedSiteTemplate(siteSettings, navigation, result.docs[0] ?? null)
  } catch {
    return { kind: 'legacy', navigation, siteSettings }
  }
})
