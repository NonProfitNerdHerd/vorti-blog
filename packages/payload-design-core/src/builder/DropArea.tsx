'use client'
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and reactive drop state through its hook result. */

import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { BuilderDragItem } from './BuilderCore'
import { takePendingLibraryItem } from './BuilderLibrary'

export function DropArea({
  add,
  addItem,
  children,
  id,
  label,
}: {
  add?: () => void
  addItem?: (item: BuilderDragItem) => void
  children: ReactNode
  id: string
  label: string
}) {
  const drop = useDroppable({ id: `container:${id}`, data: { containerID: id } })
  return (
    <div className="template-editor__drop-area">
      <div
        ref={drop.setNodeRef}
        className="template-editor__drop-target"
        data-over={drop.isOver}
        aria-label={label}
        onPointerUp={(event) => {
          event.stopPropagation()
          const item = takePendingLibraryItem()
          if (item && addItem) addItem(item)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          takePendingLibraryItem()
          const value = event.dataTransfer.getData('application/x-template-library') || event.dataTransfer.getData('text/plain')
          if (!value || !addItem) return
          try { addItem(JSON.parse(value) as BuilderDragItem) } catch { /* ignore invalid external drag data */ }
        }}
      >
        <div className="template-editor__inserter-row">
          {add && (
            <button type="button" className="template-editor__inserter" aria-label={`Add element to ${label}`} title={`Add element to ${label}`} onClick={add}>+</button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
