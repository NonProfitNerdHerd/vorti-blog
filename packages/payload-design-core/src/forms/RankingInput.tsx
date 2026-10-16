'use client'
import React, { useId, useState } from 'react'
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { FieldInputProps } from './FormRenderer'

function Item({ id, label, disabled }: { id: string; label: string; disabled?: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled })
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .5 : 1 }}><button type="button" className="forms-rank-handle" disabled={disabled} {...attributes} {...listeners} aria-label={`Reorder ${label}`} title="Drag to rank, or press Space and use arrow keys"><GripVertical size={18} /></button><span>{label}</span></li>
}
export function RankingInput({ field, value, onChange, id, disabled }: FieldInputProps) {
  const context = useId(), [announcement, setAnnouncement] = useState('')
  const ordered = Array.isArray(value) ? value.map(String) : field.options?.map(option => option.id) || []
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  return <div id={id} className="forms-ranking"><DndContext id={context} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (disabled || !over || active.id === over.id) return; const next = arrayMove(ordered, ordered.indexOf(String(active.id)), ordered.indexOf(String(over.id))); onChange(next); setAnnouncement(`${field.options?.find(option => option.id === active.id)?.label} moved to position ${next.indexOf(String(active.id)) + 1} of ${next.length}.`) }} onDragCancel={() => setAnnouncement('Ranking change cancelled.')}><SortableContext items={ordered} strategy={verticalListSortingStrategy}><ol>{ordered.map(item => <Item key={item} id={item} label={field.options?.find(option => option.id === item)?.label || item} disabled={disabled} />)}</ol></SortableContext></DndContext><span className="forms-sr-only" aria-live="polite">{announcement}</span><button type="button" disabled={disabled} onClick={() => onChange(ordered)}>Confirm this ranking</button></div>
}
