import { walkContent, type ContentNode } from '@design-system/payload-design-core/content'
import { resolveDocumentBlocks } from './content-layout'
import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Navigation, SiteSetting, SiteTemplate } from '@/payload-types'
import { fallbackPublicSiteData, getPublicSiteDataSafe } from '@/lib/publicContent'
import {
  validateAdditionalCSS,
  validateSiteShellNodes,
  type SiteShellNode,
} from '@design-system/payload-design-core'

export type ResolvedSiteShell =
  | { kind: 'legacy'; navigation: Navigation; siteSettings: SiteSetting }
  | {
      kind: 'template'
      navigation: Navigation
      siteSettings: SiteSetting
      template: SiteTemplate
      header: SiteShellNode[]
      footer: SiteShellNode[]
    }

export function selectPublishedSiteTemplate(
  siteSettings: SiteSetting,
  navigation: Navigation,
  candidate: SiteTemplate | null,
): ResolvedSiteShell {
  if (!candidate || candidate._status !== 'published')
    return { kind: 'legacy', navigation, siteSettings }
  if (
    validateSiteShellNodes(candidate.header?.layout) !== true ||
    validateSiteShellNodes(candidate.footer?.layout) !== true
  )
    return { kind: 'legacy', navigation, siteSettings }
  if (validateAdditionalCSS(candidate.additionalCSS) !== true)
    return { kind: 'legacy', navigation, siteSettings }
  return {
    kind: 'template',
    navigation,
    siteSettings,
    template: candidate,
    header: candidate.header.layout as SiteShellNode[],
    footer: candidate.footer.layout as SiteShellNode[],
  }
}

export async function resolveSiteShellFromLoaders(
  loadGlobals: () => Promise<{ navigation: Navigation; siteSettings: SiteSetting }>,
  loadTemplate: (id: number | string) => Promise<SiteTemplate | null>,
): Promise<ResolvedSiteShell> {
  let globals
  try {
    globals = await loadGlobals()
  } catch {
    return { kind: 'legacy', ...fallbackPublicSiteData }
  }
  const { navigation, siteSettings } = globals
  const selected = siteSettings.defaultSiteTemplate
  const id: number | string | null =
    typeof selected === 'object' && selected
      ? selected.id
      : typeof selected === 'number' || typeof selected === 'string'
        ? selected
        : null
  if (id == null) return { kind: 'legacy', navigation, siteSettings }
  try {
    return selectPublishedSiteTemplate(siteSettings, navigation, await loadTemplate(id))
  } catch {
    return { kind: 'legacy', navigation, siteSettings }
  }
}

export const resolvePublicSiteShell = cache(async (): Promise<ResolvedSiteShell> => {
  const payload = await getPayload({ config })
  const shell = await resolveSiteShellFromLoaders(getPublicSiteDataSafe, async (id) => {
    const result = await payload.find({
      collection: 'site-templates',
      depth: 2,
      limit: 1,
      overrideAccess: false,
      where: { and: [{ id: { equals: id } }, { _status: { equals: 'published' } }] },
    })
    return result.docs[0] ?? null
  })
  if (shell.kind === 'template') {
    const hydrate = async (nodes: SiteShellNode[]): Promise<SiteShellNode[]> => {
      const normalize = (items: SiteShellNode[]): ContentNode[] =>
        items.map((node) =>
          node.type === 'layout' && node.block
            ? {
                ...node.block,
                id: node.id,
                children: node.children?.length ? normalize(node.children) : undefined,
              }
            : {
                id: node.id,
                kind: 'group',
                styles: node.responsiveStyles,
                presentation: node.appearance,
                richText: node.type === 'element' ? node.props?.lexical : undefined,
                children:
                  node.type === 'layout'
                    ? normalize([
                        ...(node.children ?? []),
                        ...(node.columns?.flatMap((column) => column.children) ?? []),
                      ])
                    : undefined,
              },
        )
      const resolved = await resolveDocumentBlocks(payload, {
        ...shell.template,
        contentLayout: { version: 1, nodes: normalize(nodes) },
      })
      const active = new Map(walkContent(resolved ?? []).map((node) => [node.id, node]))
      const restore = (items: SiteShellNode[]): SiteShellNode[] =>
        items
          .filter((node) => active.has(node.id))
          .map((original) => {
            const node = structuredClone(original),
              value = active.get(node.id)!
            if (node.type === 'layout') {
              if (node.block) {
                const { children: _children, ...block } = value
                node.block = block
              }
              if (node.children) node.children = restore(node.children)
              if (node.columns)
                node.columns = node.columns.map((column) => ({
                  ...column,
                  children: restore(column.children),
                }))
            }
            return node
          })
      return restore(nodes)
    }
    shell.header = await hydrate(shell.header)
    shell.footer = await hydrate(shell.footer)
  }
  return shell
})
