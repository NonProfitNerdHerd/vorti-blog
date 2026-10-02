'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  closestCenter,
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
  onInsert: (item: BuilderDragItem, containerID: string, beforeID?: string) => void
  onMove: (nodeID: string, containerID: string, beforeID?: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function dragEnd(event: DragEndEvent) {
    const containerID = event.over?.data.current?.containerID as string | undefined
    if (!containerID) return
    const beforeID = event.over?.data.current?.beforeID as string | undefined
    const library = event.active.data.current?.library as BuilderDragItem | undefined
    if (library) {
      onInsert(library, containerID, beforeID)
      return
    }
    const nodeID = event.active.data.current?.nodeID as string | undefined
    if (nodeID) onMove(nodeID, containerID, beforeID)
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} onDragEnd={dragEnd}>
      {children}
    </DndContext>
  )
}
