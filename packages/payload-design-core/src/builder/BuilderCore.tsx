'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { ReactNode } from 'react'

export type BuilderDragItem = { kind: string; label: string; value: string }

export function BuilderCore({
  children,
  id,
  onInsert,
  onMove,
}: {
  children: ReactNode
  id: string
  onInsert: (item: BuilderDragItem, containerID: string) => void
  onMove: (nodeID: string, containerID: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function dragEnd(event: DragEndEvent) {
    const containerID = event.over?.data.current?.containerID as string | undefined
    if (!containerID) return
    const library = event.active.data.current?.library as BuilderDragItem | undefined
    if (library) {
      onInsert(library, containerID)
      return
    }
    const nodeID = event.active.data.current?.nodeID as string | undefined
    if (nodeID) onMove(nodeID, containerID)
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={pointerWithin} onDragEnd={dragEnd}>
      {children}
    </DndContext>
  )
}
