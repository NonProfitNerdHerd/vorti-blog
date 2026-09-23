'use client'

import type { BuilderDragItem } from './BuilderCore'

let pendingPointerItem: BuilderDragItem | null = null

export function takePendingLibraryItem(): BuilderDragItem | null {
  const item = pendingPointerItem
  pendingPointerItem = null
  return item
}

export function BuilderLibraryButton({ item, onAdd }: { item: BuilderDragItem; onAdd: () => void }) {
  return (
    <div className="template-editor__library-item">
      <button
        type="button"
        className="template-editor__library-icon"
        draggable
        aria-label={`Drag ${item.label}`}
        onPointerDown={() => { pendingPointerItem = item }}
        onPointerCancel={() => { pendingPointerItem = null }}
        onDragStart={(event) => {
          const serialized = JSON.stringify(item)
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('application/x-template-library', serialized)
          event.dataTransfer.setData('text/plain', serialized)
        }}
      >
        {item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶'}
      </button>
      <button type="button" className="template-editor__library-action" onClick={onAdd}>
        {item.label}
      </button>
    </div>
  )
}
