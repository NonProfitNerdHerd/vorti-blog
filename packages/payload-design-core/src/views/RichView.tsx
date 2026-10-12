import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import { DynamicView } from './DynamicView'
export const savedViewConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
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
