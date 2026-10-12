'use client'
import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import { useConfig } from '@payloadcms/ui'
import { getFieldPaths } from 'payload/shared'
import type { ClientField } from 'payload'
import { useState } from 'react'
import { textDocument, type ContentNode } from '../content/model'
import { InlineText } from './InlineText'

function contentEditorPath(
  fields: ClientField[],
  parentSchemaPath: string,
  parentIndexPath = '',
): string | undefined {
  for (const [index, field] of fields.entries()) {
    const paths = getFieldPaths({ field, index, parentSchemaPath, parentIndexPath, parentPath: '' })
    if (field.type === 'richText' && field.name === 'content') return paths.schemaPath
    if ('fields' in field) {
      const found = contentEditorPath(field.fields, paths.schemaPath, paths.indexPath)
      if (found) return found
    }
  }
}

/** Resolve an existing host content editor; no extra rich-text field or storage is created. */
export function RegisteredCanvasText({
  node,
  disabled,
  change,
}: {
  node: ContentNode
  disabled: boolean
  change: (patch: Partial<ContentNode>) => void
}) {
  const { config } = useConfig()
  const [focused, setFocused] = useState(false)
  const schemaPath = config.collections
    ?.map((collection) => contentEditorPath(collection.fields, `collection.${collection.slug}`))
    .find(Boolean)
  if (node.kind === 'richText' || node.richText) {
    if (!schemaPath) return <p>The host content editor is unavailable.</p>
    return (
      <RenderLexical
        field={{ name: 'content', type: 'richText', label: false, admin: { readOnly: disabled } }}
        path={`editorText.${node.id}`}
        schemaPath={schemaPath}
        value={node.richText as never}
        setValue={(richText) => change({ richText })}
      />
    )
  }
  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <InlineText node={node} disabled={disabled} onChange={(text) => change({ text })} />
      {focused && !disabled && schemaPath && node.kind !== 'button' && (
        <button type="button" onClick={() => change({ richText: textDocument(node) })}>
          Format text
        </button>
      )}
    </div>
  )
}
