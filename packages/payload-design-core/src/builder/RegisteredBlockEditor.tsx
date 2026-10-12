'use client'
import { useState } from 'react'
import { useConfig, UploadInput } from '@payloadcms/ui'
import { UnifiedBlockInspector } from './UnifiedBlockInspector'
import { VariationPicker } from './VariationPicker'
import { BackgroundMediaPicker } from './BackgroundMediaPicker'
import { DocumentPicker } from './DocumentPicker'
import { styleOnlyKinds, variationsFor } from '../blocks/variations'
import type { ContentNode, Viewport } from '../content/model'
export function RegisteredBlockEditor({
  node,
  change,
  viewport,
  bindingFields,
  listings,
}: {
  listings?: Array<{ id: string; label: string }>
  node: ContentNode
  bindingFields?: Array<{ path: string; label: string }>
  viewport?: Viewport
  change: (node: ContentNode) => void
}) {
  const { config } = useConfig()
  const patch = (patch: Partial<ContentNode>) => change({ ...node, ...patch })
  return (
    <UnifiedBlockInspector
      listings={listings}
      renderDocumentPicker={(collection, label, value, change) => (
        <DocumentPicker collection={collection} label={label} value={value} change={change} />
      )}
      renderBackgroundMedia={(value, change) => (
        <BackgroundMediaPicker value={value} change={change} />
      )}
      bindingFields={bindingFields}
      viewport={viewport}
      node={node}
      onChange={patch}
    >
      <label>
        Block label
        <input
          value={node.label ?? ''}
          onChange={(event) => patch({ label: event.target.value })}
        />
      </label>
      {['heading', 'paragraph', 'quote', 'list', 'button', 'image'].includes(node.kind) && (
        <label>
          {node.kind === 'image' ? 'Caption' : 'Text'}
          <textarea
            value={node.text ?? ''}
            onChange={(event) => patch({ text: event.target.value })}
          />
        </label>
      )}
      {node.kind === 'heading' && (
        <label>
          Heading level
          <select
            value={node.level ?? 2}
            onChange={(event) => patch({ level: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
      )}
      {['button', 'video'].includes(node.kind) && (
        <label>
          URL
          <input value={node.url ?? ''} onChange={(event) => patch({ url: event.target.value })} />
        </label>
      )}
      {['image', 'gallery'].includes(node.kind) && (
        <>
          <UploadInput
            api={config.routes.api}
            allowCreate
            hasMany={node.kind === 'gallery'}
            isSortable={node.kind === 'gallery'}
            label="Image"
            onChange={(media) => patch({ media })}
            path={`block-media-${node.id}`}
            relationTo="media"
            serverURL={config.serverURL}
            showError={false}
            value={node.media as never}
          />
          <label>
            Alternative text
            <input
              value={node.alt ?? ''}
              onChange={(event) => patch({ alt: event.target.value })}
            />
          </label>
        </>
      )}
    </UnifiedBlockInspector>
  )
}
export function NewRegisteredBlock({
  node,
  create,
  cancel,
}: {
  node: ContentNode
  create: (node: ContentNode) => void
  cancel: () => void
}) {
  const [draft, setDraft] = useState(node)
  const [choosing, setChoosing] = useState(
    variationsFor(node.kind).length > 1 && !styleOnlyKinds.has(node.kind),
  )
  return (
    <>
      {choosing ? (
        <VariationPicker
          node={draft}
          initial
          onChange={setDraft}
          onDone={() => setChoosing(false)}
        />
      ) : (
        <RegisteredBlockEditor node={draft} change={setDraft} />
      )}
      <button type="button" onClick={() => create(draft)}>
        Save Element
      </button>
      <button type="button" onClick={cancel}>
        Cancel
      </button>
    </>
  )
}
