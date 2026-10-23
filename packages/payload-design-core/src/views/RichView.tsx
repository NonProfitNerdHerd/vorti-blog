import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import { DynamicView } from './DynamicView'
import { SiteAnchor } from '../PublicSiteContext'
import type { SerializedLinkNode } from '@payloadcms/richtext-lexical'

function linkHref(node: SerializedLinkNode) {
  if (node.fields.linkType !== 'internal') return node.fields.url || '#'
  const reference = node.fields.doc
  const value = reference?.value
  if (!value || typeof value !== 'object' || typeof value.slug !== 'string') return '#'
  return (reference.relationTo === 'posts' ? '/posts/' : '/') + value.slug
}
export const savedViewConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
  link: ({ node, nodesToJSX }) => (
    <SiteAnchor
      href={linkHref(node)}
      target={node.fields.newTab ? '_blank' : undefined}
      rel={node.fields.newTab ? 'noopener noreferrer' : undefined}
    >
      {nodesToJSX({ nodes: node.children })}
    </SiteAnchor>
  ),
  autolink: ({ node, nodesToJSX }) => (
    <SiteAnchor
      href={node.fields.url || '#'}
      target={node.fields.newTab ? '_blank' : undefined}
      rel={node.fields.newTab ? 'noopener noreferrer' : undefined}
    >
      {nodesToJSX({ nodes: node.children })}
    </SiteAnchor>
  ),
  blocks: {
    savedViewEmbed: ({ node }: { node: { fields: Record<string, unknown> } }) => {
      const fields = node.fields as unknown as { viewID?: unknown }
      const ref = fields.viewID
      const id = ref && typeof ref === 'object' ? ('id' in ref ? ref.id : undefined) : ref
      return (
        <DynamicView viewID={typeof id === 'string' || typeof id === 'number' ? id : undefined} />
      )
    },
  },
})
