'use client'
import React, { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react'
import { FormPartIcon } from './FormPartIcon'
import { formFields } from './registry'
import { flattenFields, type FormField } from './model'
import { virtualCanvasID } from './canvases'

function Row({ field, selected, select, menu, readOnly, children, expanded, toggle }: { field: FormField; selected?: string; select: (id: string) => void; menu: (id: string) => void; readOnly?: boolean; children?: React.ReactNode; expanded: boolean; toggle: () => void }) {
  const virtual = field.id === virtualCanvasID
  const { setNodeRef: drag, attributes, listeners, isDragging } = useDraggable({ id: `list:${field.id}`, disabled: readOnly || virtual })
  const { setNodeRef: drop, isOver } = useDroppable({ id: `listtarget:${field.id}` })
  return <li ref={drop} className={isOver ? 'forms-tree-drop' : undefined}><div className={`forms-tree-row ${selected === field.id ? 'is-selected' : ''}`} style={{ opacity: isDragging ? .4 : 1 }}>
    {field.children ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${field.label}`} aria-expanded={expanded} onClick={toggle}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="forms-tree-spacer" />}
    <button type="button" ref={drag} {...attributes} {...listeners} aria-disabled={undefined} data-form-tree-row aria-pressed={selected === field.id} onClick={() => select(field.id)} onKeyDown={event => {
      if (event.key === 'ArrowRight' && field.children) { event.preventDefault(); if (!expanded) toggle(); else event.currentTarget.closest('li')?.querySelector<HTMLElement>('ul [data-form-tree-row]')?.focus() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); if (field.children && expanded) toggle(); else event.currentTarget.closest('li')?.parentElement?.closest('li')?.querySelector<HTMLElement>('[data-form-tree-row]')?.focus() }
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll<HTMLElement>('[data-form-tree-row]') || []), index = rows.indexOf(event.currentTarget)
        rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      } else listeners?.onKeyDown?.(event)
    }}><FormPartIcon kind={field.layout?.kind === 'column' ? 'column' : field.kind} /><span>{field.label || 'Untitled part'}<small>{virtual ? 'Existing content' : field.layout?.kind === 'column' ? 'Column' : formFields.get(field.kind)?.label}</small></span></button>
    <button type="button" aria-label={`Actions for ${field.label}`} onClick={() => menu(field.id)}><MoreVertical size={16} /></button>
  </div>{expanded && children}</li>
}
export function FormHierarchy({ canvases, selected, select, menu, readOnly }: { canvases: FormField[]; selected?: string; select: (id: string) => void; menu: (id: string) => void; readOnly?: boolean }) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const draw = (field: FormField): React.ReactNode => {
    const containsSelected = flattenFields(field.children || []).some(child => child.id === selected)
    const expanded = !collapsed.includes(field.id) || containsSelected
    return <Row key={field.id} field={field} selected={selected} select={select} menu={menu} readOnly={readOnly} expanded={expanded} toggle={() => { if (containsSelected && expanded) select(field.id); setCollapsed(old => expanded ? [...old.filter(id => id !== field.id), field.id] : old.filter(id => id !== field.id)) }}>{field.children?.length ? <ul>{field.children.map(draw)}</ul> : null}</Row>
  }
  return <ul className="forms-hierarchy" aria-label="Form hierarchy">{canvases.map(draw)}</ul>
}
