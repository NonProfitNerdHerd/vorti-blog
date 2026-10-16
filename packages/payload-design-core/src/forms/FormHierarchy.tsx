'use client'
import React, { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react'
import { FormPartIcon } from './FormPartIcon'
import { blockLabel, contactComponents } from './contact'
import { formFields } from './registry'
import { flattenFields, type FormField } from './model'
import { virtualCanvasID } from './canvases'

function Row({ field, selected, select, menu, readOnly, children, expanded, toggle, open }: { field: FormField; selected?: string; select: (id: string) => void; menu: (id: string) => void; readOnly?: boolean; children?: React.ReactNode; expanded: boolean; toggle: () => void; open: () => void }) {
  const virtual = field.id === virtualCanvasID
  const { setNodeRef: drag, attributes, listeners, isDragging } = useDraggable({ id: `list:${field.id}`, disabled: readOnly || virtual })
  const { setNodeRef: drop, isOver } = useDroppable({ id: `listtarget:${field.id}` })
  return <li ref={drop} className={isOver ? 'forms-tree-drop' : undefined}><div className={`forms-tree-row ${selected === field.id ? 'is-selected' : ''}`} style={{ opacity: isDragging ? .4 : 1 }}>
    {(field.children || contactComponents(field).length > 0) ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${blockLabel(field)}`} aria-expanded={expanded} onClick={toggle}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="forms-tree-spacer" />}
    <button type="button" ref={drag} {...attributes} {...listeners} aria-disabled={undefined} data-form-tree-row aria-pressed={selected === field.id} onClick={() => select(field.id)} onDoubleClick={open} onKeyDown={event => {
      if (event.key === 'ArrowRight' && (field.children || contactComponents(field).length)) { event.preventDefault(); if (!expanded) toggle(); else event.currentTarget.closest('li')?.querySelector<HTMLElement>('ul [data-form-tree-row], ul [data-form-component-row]')?.focus() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); if ((field.children || contactComponents(field).length) && expanded) toggle(); else event.currentTarget.closest('li')?.parentElement?.closest('li')?.querySelector<HTMLElement>('[data-form-tree-row]')?.focus() }
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll<HTMLElement>('[data-form-tree-row], [data-form-component-row]') || []), index = rows.indexOf(event.currentTarget)
        rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      } else listeners?.onKeyDown?.(event)
    }}><FormPartIcon kind={field.layout?.kind === 'column' ? 'column' : field.kind} /><span>{blockLabel(field) || 'Untitled part'}<small>{virtual ? 'Existing content' : field.layout?.kind === 'column' ? 'Column' : formFields.get(field.kind)?.label}</small></span></button>
    <button type="button" aria-label={`Actions for ${blockLabel(field)}`} onClick={() => menu(field.id)}><MoreVertical size={16} /></button>
  </div>{expanded && children}</li>
}
export function FormHierarchy({ canvases, selected, select, menu, readOnly, component, open }: { canvases: FormField[]; selected?: string; select: (id: string, component?: string) => void; menu: (id: string) => void; readOnly?: boolean; component?: string; open: (id: string, component?: string) => void }) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const draw = (field: FormField): React.ReactNode => {
    const containsSelected = flattenFields(field.children || []).some(child => child.id === selected)
    const expanded = !collapsed.includes(field.id) || containsSelected || (selected === field.id && !!component)
    return <Row key={field.id} open={() => open(field.id)} field={field} selected={selected} select={select} menu={menu} readOnly={readOnly} expanded={expanded} toggle={() => { if (containsSelected && expanded) select(field.id); setCollapsed(old => expanded ? [...old.filter(id => id !== field.id), field.id] : old.filter(id => id !== field.id)) }}>{field.children?.length ? <ul>{field.children.map(draw)}</ul> : null}{contactComponents(field).length > 0 && <ul>{contactComponents(field).map(part => <li key={part.key}><button type="button" data-form-component-row onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); event.currentTarget.closest('ul')?.parentElement?.querySelector<HTMLElement>('[data-form-tree-row]')?.focus() } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll<HTMLElement>('[data-form-tree-row], [data-form-component-row]') || []), index = rows.indexOf(event.currentTarget); rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus() } }} aria-pressed={selected === field.id && component === part.key} onClick={() => select(field.id, part.key)} onDoubleClick={() => open(field.id, part.key)}><FormPartIcon kind="text" />{part.label}</button></li>)}</ul>}</Row>
  }
  return <ul className="forms-hierarchy" aria-label="Form hierarchy">{canvases.map(draw)}</ul>
}
