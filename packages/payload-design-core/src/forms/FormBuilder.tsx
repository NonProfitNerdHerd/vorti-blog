'use client'
import { createPortal } from 'react-dom'
import React, { useEffect, useId, useRef, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, pointerWithin, rectIntersection, useSensor, useSensors, useDraggable, useDroppable, type CollisionDetection } from '@dnd-kit/core'
import { Maximize2, Undo2, Redo2, Monitor, Tablet, Smartphone, Plus, ListTree } from 'lucide-react'
import { formFields } from './registry'
import { flattenFields, makeID, type FormDefinition, type FormField } from './model'
import { validateDefinition } from './engine'
import { FormRenderer, fieldRenderers } from './FormRenderer'
import { GraphEditor } from './GraphEditor'
import { canvasButtons } from './graph'
import type { PaymentAvailability } from './PaymentSettings'
import { ActionsEditor } from './ActionsEditor'
import { duplicateFormField } from './clone'
import { FormTransfer } from './FormTransfer'
import { canvasItems, owningCanvas, virtualCanvasID, organizeCanvases, organizeIssue, newCanvas, movePart, deletionPlan } from './canvases'
import { FormHierarchy } from './FormHierarchy'
import { FormBuilderDialog } from './FormBuilderDialog'
import { FormPartIcon } from './FormPartIcon'
import { ColumnPicker } from './ColumnPicker'
import { columnTracks, createColumn, setColumnLayout } from './columns'
import { FieldSettings } from './FieldSettings'
import { ContactInput } from './ContactInput'
import { blockLabel, contactComponents, widthFraction, widthStyle } from './contact'
import { ResizeHandle } from './WidthControl'
import './builder.css'

export interface FormBuilderProps { onCreateExample?: () => Promise<string>; navigationTarget?: HTMLElement | null; navigation?: { view: string; onChange: (view: string) => void }; toolbarTarget?: HTMLElement | null; emailTarget?: HTMLElement | null; onEmailIssue?: () => void; transferTarget?: HTMLElement | null; local?: boolean; integrations?: { id: string; label: string; provider: string; configured: boolean }[]; postTypes?: { id: string; label: string }[]; payments?: PaymentAvailability; resources?: { id: string; label: string }[]; value: FormDefinition; onChange: (value: FormDefinition) => void; readOnly?: boolean; saveStatus?: string; onSave?: () => void; onPublish?: () => void; children?: React.ReactNode }
const containers = ['row', 'section', 'step', 'repeater']
const fieldCollision: CollisionDetection = args => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)
  return hits.sort((a, b) => {
    const first = args.droppableRects.get(a.id), second = args.droppableRects.get(b.id)
    return (first ? first.width * first.height : Infinity) - (second ? second.width * second.height : Infinity)
  })
}
function PaletteField({ kind, label, description, disabled, add }: { kind: string; label: string; description: string; disabled?: boolean; add: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `palette:${kind}`, disabled })
  return <button type="button" ref={setNodeRef} {...listeners} {...attributes} disabled={disabled} title={`${description} Click to add, or drag onto the canvas.`} onClick={add} style={{ opacity: isDragging ? .5 : 1 }}><FormPartIcon kind={kind} />{label}</button>
}
function CanvasDrop({ device, target, label, children }: { device: string; target: string; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `target:${target}` })
  return <main aria-label="Form canvas" data-canvas-label={label} ref={setNodeRef} className={`forms-builder-canvas forms-device-${device} ${isOver ? 'is-drop' : ''}`}>{children}</main>
}
function mapFields(fields: FormField[], id: string, action: (field: FormField) => FormField | null): FormField[] {
  return fields.flatMap(field => { if (field.id === id) { const next = action(field); return next ? [next] : [] } return [{ ...field, ...(field.children ? { children: mapFields(field.children, id, action) } : {}) }] })
}
function FieldCard({ field, selected, select, open, children }: { field: FormField; selected: boolean; select: () => void; open: () => void; children?: React.ReactNode }) {
  const { setNodeRef: setDropNode, isOver } = useDroppable({ id: `target:${field.id}` })
  return <div ref={setDropNode} role="group" tabIndex={0} aria-label={`${blockLabel(field)} ${field.layout?.kind === 'column' ? 'Column' : formFields.get(field.kind)?.label}`} data-form-part={field.id} className={`forms-canvas-card forms-clean-part ${containers.includes(field.kind) ? 'forms-layout-part' : ''} ${field.layout?.kind === 'columns' && field.layout.width === 'full' ? 'forms-editor-full-part' : ''} ${selected ? 'is-selected' : ''} ${isOver ? 'is-drop' : ''}`} style={{ gridColumn: field.layout?.kind === 'column' ? 'auto' : `span ${field.width || 12}` }} onDoubleClick={event => { event.stopPropagation(); open() }} onClick={event => { event.stopPropagation(); select() }} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); select() } }}>
    {children}
  </div>
}
export function FormBuilder({ onCreateExample, navigationTarget, navigation, toolbarTarget, emailTarget, onEmailIssue, transferTarget, value, onChange, readOnly, saveStatus, onSave, onPublish, children, resources, payments, postTypes, integrations, local }: FormBuilderProps) {
  const dragContextID = useId()
  const [localView, setLocalView] = useState('Build')
  const tab = navigation?.view ?? localView
  const setTab = (view: string) => navigation ? navigation.onChange(view) : setLocalView(view)
  const preview = tab === 'Preview'
  const previousView = useRef('Build')
  const togglePreview = () => { if (preview) setTab(previousView.current); else { previousView.current = tab; setTab('Preview') } }
  const [component, setComponent] = useState<string>()
  const [expandedSettings, setExpandedSettings] = useState(false)
  const [selected, setSelection] = useState<string | undefined>(() => value.fields.length === 1 && containers.includes(value.fields[0].kind) ? value.fields[0].id : undefined), [search, setSearch] = useState('')
  const [device, setDevice] = useState('desktop'), [announcement, setAnnouncement] = useState('')
  const [history, setHistory] = useState<FormDefinition[]>([]), [future, setFuture] = useState<FormDefinition[]>([])
  const [dragLabel, setDragLabel] = useState('')
  const [activeCanvasID, setActiveCanvasID] = useState<string>()
  const [sidebar, setSidebar] = useState<'List View' | 'Add Parts'>('List View')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => { setMobile(media.matches); setSidebarOpen(!media.matches) }
    const frame = requestAnimationFrame(update)
    media.addEventListener('change', update)
    return () => { cancelAnimationFrame(frame); media.removeEventListener('change', update) }
  }, [])
  const [inserter, setInserter] = useState(false)
  const [insertion, setInsertion] = useState<{ parent: string; before?: string }>()
  const [choosingLayout, setChoosingLayout] = useState<string>()
  const [layoutError, setLayoutError] = useState('')
  const insertionAnchor = useRef<HTMLButtonElement>(null)
  const insertButton = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null)
  const [menuID, setMenuID] = useState<string>()
  const [deleteID, setDeleteID] = useState<string>()
  const [organizing, setOrganizing] = useState(false)
  const canvases = canvasItems(value.fields)
  const activeCanvas = canvases.find(canvas => canvas.id === (owningCanvas(value.fields, selected) || activeCanvasID)) || canvases[0]
  const setSelected = (id?: string, subfield?: string) => { setComponent(subfield); setSelection(id); const owner = owningCanvas(value.fields, id); if (owner) setActiveCanvasID(owner); if (mobile) setSidebarOpen(false) }
  const menuPart = canvases.find(part => part.id === menuID) || flattenFields(value.fields).find(part => part.id === menuID)
  const deletePart = flattenFields(value.fields).find(part => part.id === deleteID)
  const removal = deleteID ? deletionPlan(value, deleteID) : undefined
  const structureIssue = organizeIssue(value.fields)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }))
  const fields = flattenFields(value.fields), current = fields.find(f => f.id === (selected || activeCanvas.id))
  const issues = validateDefinition(value)
  const change = (next: FormDefinition) => { if (readOnly) return; setHistory(previous => [...previous, structuredClone(value)].slice(-100)); setFuture([]); onChange(next) }
  const update = (patch: Partial<FormField>) => current && change({ ...value, fields: mapFields(value.fields, current.id, f => ({ ...f, ...(patch.label !== undefined && !f.blockLabel ? { blockLabel: f.label } : {}), ...patch })) })
  const add = (kind: string, target?: string) => {
    if (readOnly) return
    if (mobile) setSidebarOpen(false)
    if (kind === 'step') {
      setInsertion(undefined)
      setInserter(false)
      if (structureIssue) { setAnnouncement(structureIssue); return }
      if (value.fields.some(field => field.kind !== 'step')) { setOrganizing(true); return }
      const canvas = newCanvas(value.fields)
      change({ ...value, fields: [...value.fields, canvas] }); setActiveCanvasID(canvas.id); setComponent(undefined); setSelection(canvas.id); setSidebar('List View'); setAnnouncement(canvas.label + ' added.'); return
    }
    const definition = formFields.get(kind)!, field: FormField = { id: makeID(), kind, label: definition.label, blockLabel: definition.label, width: 12 }
    if (['name', 'phone', 'address'].includes(kind)) field.contact = { format: kind === 'name' ? 'firstLast' : 'us' }
    if (definition.choices) field.options = ['First option', 'Second option', 'Third option'].map((label, i) => ({ id: makeID('option'), label, value: String(i + 1) }))
    if (kind === 'likert') field.rows = ['Service', 'Quality'].map(label => ({ id: makeID('row'), label, value: label }))
    if (containers.includes(kind)) field.children = []
    if (kind === 'row') { field.layout = { kind: 'columns', width: 'inherit' }; field.children = [createColumn(0, 50), createColumn(1, 50)] }
    if (kind === 'calculated') field.expression = '0'
    if (kind === 'upload') field.files = { maxCount: 3, maxBytes: 10 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] }
    if (kind === 'datetime') field.date = { timezone: 'UTC' }
    let destination = target ? fields.find(item => item.id === target) : current || (activeCanvas.id !== virtualCanvasID ? activeCanvas : undefined)
    if (destination?.layout?.kind === 'columns') destination = destination.children?.[0]
    let next: FormField[]
    if (insertion && !target) {
      const insert = (items: FormField[]) => insertion.before ? items.flatMap(item => item.id === insertion.before ? [field, item] : [item]) : [...items, field]
      next = insertion.parent === virtualCanvasID ? insert(value.fields) : mapFields(value.fields, insertion.parent, parent => ({ ...parent, children: insert(parent.children || []) }))
    }
    else if (destination && containers.includes(destination.kind)) next = mapFields(value.fields, destination.id, parent => ({ ...parent, children: [...parent.children || [], field] }))
    else if (destination) {
      const before = (items: FormField[]): FormField[] => items.flatMap(item => item.id === destination.id ? (target ? [field, item] : [item, field]) : [{ ...item, ...(item.children ? { children: before(item.children) } : {}) }])
      next = before(value.fields)
    } else next = [...value.fields, field]
    change({ ...value, fields: next })
    setComponent(undefined); setSelection(field.id); setActiveCanvasID(owningCanvas(next, field.id)); setInserter(false); setInsertion(undefined); setChoosingLayout(kind === 'row' ? field.id : undefined); setAnnouncement(`${field.label} added.`)
  }
  const move = (id: string, target: string) => {
    if (readOnly) return
    const next = movePart(value.fields, id, target)
    if (validateDefinition({ ...value, fields: next }).some(issue => issue.message.includes('Column'))) { setAnnouncement('Keep column containers inside their Columns layout. Full Page Columns must stay directly on a Canvas.'); return }
    if (next === value.fields) { setAnnouncement('Choose a valid destination. Canvases must remain at the top level.'); return }
    change({ ...value, fields: next }); setComponent(undefined); setSelection(id); setActiveCanvasID(owningCanvas(next, id)); setAnnouncement('Part moved.')
  }
  const shift = (delta: number, id = current?.id) => {
    if (!id || readOnly) return
    const reorder = (items: FormField[]): FormField[] => {
      const index = items.findIndex(f => f.id === id)
      if (index >= 0 && index + delta >= 0 && index + delta < items.length) { const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next }
      return items.map(f => ({ ...f, ...(f.children ? { children: reorder(f.children) } : {}) }))
    }
    change({ ...value, fields: reorder(value.fields) })
  }
  const openInsertion = (parent: string, before?: string) => { setInsertion({ parent, before }); setSearch(''); setInserter(true) }
  const insertionButton = (parent: string, before?: string, empty = false) => <div className={empty ? 'forms-insert-empty' : 'forms-insert-point'}><button type="button" disabled={readOnly} aria-label={before ? 'Add part before ' + blockLabel(fields.find(field => field.id === before) || activeCanvas) : 'Add parts to ' + blockLabel(fields.find(field => field.id === parent) || activeCanvas)} title="Add parts" onClick={event => { event.stopPropagation(); insertionAnchor.current = event.currentTarget; openInsertion(parent, before) }}><Plus size={16} /></button></div>
  const chooseLayout = (id: string, weights: number[]) => { const result = setColumnLayout(value, id, weights); setLayoutError(result.error || ''); if (!result.error) { change(result.definition); setChoosingLayout(undefined) } }
  const duplicate = (id: string) => { const copy = duplicateFormField(value, id); const issue = validateDefinition(copy.definition).find(issue => /column/i.test(issue.message)); if (issue) { setLayoutError(issue.message); return } change(copy.definition); setComponent(undefined); setSelection(copy.selected); setActiveCanvasID(owningCanvas(copy.definition.fields, copy.selected)); setMenuID(undefined) }
  const resize = (id: string, width: number, subfield?: string) => { if (readOnly) return; change({ ...value, fields: mapFields(value.fields, id, field => subfield ? { ...field, components: { ...field.components, [subfield]: { ...field.components?.[subfield], widthFraction: width } } } : { ...field, widthFraction: width }) }) }
  const settingsAnchor = useRef<HTMLElement | null>(null)
  const openSettings = (id: string, subfield?: string) => { settingsAnchor.current = document.activeElement as HTMLElement; setSelected(id, subfield); setExpandedSettings(true) }
  const drawChildren = (items: FormField[], parent: string, row?: FormField): React.ReactNode => <div className={row ? 'forms-editor-columns' : 'forms-builder-grid'} style={row ? { gridTemplateColumns: columnTracks(row) } : undefined}>{items.map(field => <div key={field.id} data-width-part className="forms-part-slot" style={row ? undefined : widthStyle(field.layout?.kind === 'columns' && field.layout.width === 'full' ? 1 : widthFraction(field))}>{!row && insertionButton(parent, field.id)}{draw(field)}{selected === field.id && !component && !readOnly && !row && !(field.layout?.kind === 'columns' && field.layout.width === 'full') && <ResizeHandle value={widthFraction(field)} label={blockLabel(field)} onChange={width => resize(field.id, width)} />}</div>)}{!row && insertionButton(parent, undefined, !items.length)}</div>
  const draw = (field: FormField): React.ReactNode => {
    const Input = fieldRenderers.get(field.kind)
    return <FieldCard field={field} selected={field.id === selected} select={() => setSelected(field.id)} open={() => openSettings(field.id, field.id === selected ? component : undefined)}>{field.layout?.kind === 'columns' ? <div className={'forms-editor-layout forms-editor-' + (field.layout.width || 'inherit')}>{choosingLayout === field.id && <section className="forms-layout-chooser" aria-label="Select a column layout" onClick={event => event.stopPropagation()}><p>Select a layout to start with</p><ColumnPicker disabled={readOnly} value={field.children?.map(child => child.layout?.kind === 'column' ? child.layout.weight : 1) || []} onChange={weights => chooseLayout(field.id, weights)} /><button type="button" onClick={() => setChoosingLayout(undefined)}>Skip</button></section>}{drawChildren(field.children || [], field.id, field)}</div> : containers.includes(field.kind) ? <>{field.kind === 'section' && !field.layout && <h3>{field.label}</h3>}{drawChildren(field.children || [], field.id)}</> : <div className="forms-build-input">{field.kind === 'divider' ? <hr /> : field.kind === 'heading' ? <h3>{field.label}</h3> : field.kind === 'content' ? <p>{field.help || field.label}</p> : <><div className="forms-question-label">{field.label}{field.required ? ' *' : ''}</div>{contactComponents(field).length ? <ContactInput field={field} id={'build-' + field.id} value={field.defaultValue} onChange={() => {}} build selectedComponent={selected === field.id ? component : undefined} selectComponent={key => setSelected(field.id, key)} resizeComponent={readOnly ? undefined : (key, width) => resize(field.id, width, key)} /> : <div className="forms-build-answer" inert>{Input ? <Input field={field} id={'build-' + field.id} value={field.defaultValue} onChange={() => {}} disabled /> : <span>{field.placeholder || 'Answer goes here'}</span>}</div>}{field.help && <small>{field.help}</small>}</>}</div>}</FieldCard>
  }
  const settings = current && <FieldSettings key={current.id + ':' + (component || '')} current={current} component={component} value={value} readOnly={readOnly} update={update} chooseLayout={chooseLayout} shift={shift} move={move} duplicate={duplicate} setDeleteID={setDeleteID} resources={resources} />
  const matches = formFields.list().filter(part => (part.label + ' ' + part.description).toLowerCase().includes(search.trim().toLowerCase()))
  const palette = (draggable: boolean) => <><input type="search" aria-label="Search parts" placeholder="Search parts" value={search} onChange={event => setSearch(event.target.value)} />{['Basic', 'Choices', 'Dates', 'Advanced', 'Layout'].filter(category => matches.some(part => part.category === category)).map(category => <section key={category}><h4>{category}</h4>{matches.filter(part => part.category === category).map(part => draggable ? <PaletteField key={part.kind} kind={part.kind} label={part.label} description={part.description} disabled={readOnly || (part.kind === 'step' && !!structureIssue)} add={() => add(part.kind)} /> : <button key={part.kind} type="button" disabled={readOnly || (part.kind === 'step' && !!structureIssue)} onClick={() => add(part.kind)}><FormPartIcon kind={part.kind} />{part.label}</button>)}</section>)}{!matches.length && <p role="status">No parts match your search.</p>}</>
  const sidebarPanel = <aside className="forms-palette forms-sidebar" aria-label="Form parts sidebar"><div role="tablist" aria-label="Form parts navigation">{(['List View', 'Add Parts'] as const).map(name => <button key={name} role="tab" type="button" aria-selected={sidebar === name} onClick={() => setSidebar(name)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setSidebar(sidebar === 'List View' ? 'Add Parts' : 'List View'); (event.currentTarget.parentElement?.querySelectorAll('button')[sidebar === 'List View' ? 1 : 0] as HTMLButtonElement)?.focus() } }}>{name}</button>)}</div><div className="forms-add-canvas-row"><button type="button" aria-label="Add parts to selected location" title="Add parts" disabled={readOnly} onClick={event => { insertionAnchor.current = event.currentTarget; setInsertion(undefined); setSearch(''); setInserter(true) }}><Plus size={18} /></button><button type="button" aria-label="Add Canvas" title="Add Canvas" disabled={readOnly || !!structureIssue} onClick={() => add('step')}><FormPartIcon kind="step" /></button></div>{sidebar === 'List View' ? <FormHierarchy canvases={canvases} selected={selected || activeCanvas.id} select={setSelected} component={component} open={openSettings} menu={setMenuID} readOnly={readOnly} /> : <div className="forms-part-palette">{palette(true)}</div>}{structureIssue && <p role="status">{structureIssue}</p>}</aside>
  const navigationControls = <div className="forms-builder forms-navigation-controls"><button ref={insertButton} type="button" aria-label="Add parts" aria-haspopup="dialog" aria-expanded={inserter} disabled={readOnly} onClick={event => { insertionAnchor.current = event.currentTarget; setTab('Build'); setInsertion(undefined); setSearch(''); setInserter(true) }}><Plus size={18} /></button><button type="button" aria-label="Toggle form List View" aria-pressed={sidebarOpen} onClick={() => { setTab('Build'); setSidebar('List View'); setSidebarOpen(!sidebarOpen) }}><ListTree size={18} /></button></div>
  const transfer = <FormTransfer expanded={transferTarget !== undefined} value={value} readOnly={readOnly} onImport={definition => { change(definition); setSelected(undefined); setAnnouncement('Imported form definition. Review settings before publishing.') }} />
  const toolbar = <header className="forms-builder-header" aria-label="Form builder controls">{!navigation && <div role="tablist" aria-label="Form settings">{['Build', 'Logic', 'Design', 'Actions', 'Access'].map(name => <button key={name} role="tab" type="button" aria-selected={tab === name} onClick={() => { setTab(name) }}>{name}</button>)}</div>}<div className="forms-builder-actions"><button type="button" aria-label="Undo form change" disabled={readOnly || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { setHistory(history.slice(0, -1)); setFuture([...future, value]); onChange(previous) } }}><Undo2 size={18} /></button><button type="button" aria-label="Redo form change" disabled={readOnly || !future.length} onClick={() => { const next = future.at(-1); if (next) { setFuture(future.slice(0, -1)); setHistory([...history, value]); onChange(next) } }}><Redo2 size={18} /></button>{[['desktop', Monitor], ['tablet', Tablet], ['phone', Smartphone]].map(([name, Icon]) => { const Component = Icon as typeof Monitor; return <button type="button" key={String(name)} aria-label={`${name} preview`} aria-pressed={device === name} onClick={() => setDevice(String(name))}><Component size={18} /></button> })}<button type="button" aria-pressed={preview} onClick={togglePreview}>{preview ? 'Return to builder' : 'Try form'}</button><button type="button" aria-pressed={tab === 'Publish' && !preview} onClick={() => { setTab('Publish') }}>Publish</button></div><div className="forms-builder-save-status" role="status">{saveStatus}</div></header>
  return <div ref={root} className="forms-builder" data-workspace-view={tab}>{navigationTarget === undefined ? navigationControls : navigationTarget ? createPortal(navigationControls, navigationTarget) : null}{toolbarTarget === undefined ? toolbar : toolbarTarget ? createPortal(toolbar, toolbarTarget) : null}
    <p className="forms-sr-only" aria-live="polite">{announcement}</p>
    {tab === 'Build' && !preview ? <DndContext id={dragContextID} sensors={sensors} collisionDetection={fieldCollision} onDragStart={event => setDragLabel(String(event.active.id).startsWith('palette:') ? formFields.get(String(event.active.id).slice(8))?.label || 'Part' : blockLabel(fields.find(field => field.id === String(event.active.id).replace('list:', '')) || activeCanvas))} onDragCancel={() => setDragLabel('')} onDragEnd={event => { setDragLabel(''); if (event.over) { const id = String(event.active.id), target = String(event.over.id).replace(/^(listtarget:|target:)/, ''); if (id.startsWith('palette:')) add(id.slice(8), target); else move(id.replace('list:', ''), target) } }}><div className={`forms-builder-workspace ${sidebarOpen ? '' : 'forms-sidebar-closed'}`}>
      {sidebarOpen && (mobile ? <FormBuilderDialog title="Form parts" close={() => setSidebarOpen(false)}>{sidebarPanel}</FormBuilderDialog> : sidebarPanel)}
      <CanvasDrop device={device} target={activeCanvas.id} label={blockLabel(activeCanvas)}>{drawChildren(activeCanvas.children || [], activeCanvas.id)}{!activeCanvas.children?.length && activeCanvas.id === virtualCanvasID && <button type="button" disabled={readOnly} onClick={() => add('step')}>Add first Canvas</button>}{activeCanvas.kind === 'step' && (value.graph || activeCanvas.buttons) && <div className="forms-builder-actions" aria-label="Canvas button previews">{canvasButtons(value, activeCanvas.id).map(button => <button type="button" key={button.id} onClick={() => setSelected(activeCanvas.id)}>{button.label}</button>)}</div>}</CanvasDrop>
      <aside className="forms-settings">{layoutError && <p role="alert">{layoutError}</p>}<h3><FormPartIcon kind={current?.layout?.kind === 'column' ? 'column' : current?.kind || 'step'} />{current?.kind === 'step' ? 'Canvas settings' : 'Field settings'}<button type="button" className="forms-expand-settings" aria-label="Expand settings" title="Expand settings" disabled={!current} onClick={() => { if (current) openSettings(current.id, component) }}><Maximize2 size={18} /></button></h3>{current && !expandedSettings ? settings : <p>Select a canvas field to edit its settings.</p>}</aside></div><DragOverlay dropAnimation={null}>{dragLabel ? <div className="forms-drag-overlay">{dragLabel}</div> : null}</DragOverlay></DndContext> : preview ? <div className={`forms-builder-preview forms-device-${device}`}><FormRenderer definition={value} preview showLogic /></div> : tab === 'Logic' ? <GraphEditor onCreateExample={onCreateExample} definition={value} onChange={change} disabled={readOnly} editCanvas={id => { setSelected(id); setActiveCanvasID(id); setTab('Build') }} /> : tab === 'Design' ? <fieldset disabled={readOnly} className="forms-builder-panel"><legend>Presentation</legend><label>Mode<select value={value.mode} onChange={e => change({ ...value, mode: e.target.value as FormDefinition['mode'] })}><option value="standard">Standard</option><option value="steps">Multi-step</option><option value="conversational">Conversational</option></select></label><label>Locale<input value={value.locale} onChange={e => change({ ...value, locale: e.target.value })} /></label><label>Direction<select value={value.direction} onChange={e => change({ ...value, direction: e.target.value as 'ltr' | 'rtl' })}><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>{['primary', 'background', 'text', 'border', 'error'].map(key => <label key={key}>{key} color<input type="color" value={value.theme[key as 'primary']} onChange={e => change({ ...value, theme: { ...value.theme, [key]: e.target.value } })} /></label>)}{['spacing', 'radius'].map(key => <label key={key}>{key}<input type="number" min={0} max={64} value={value.theme[key as 'spacing']} onChange={e => change({ ...value, theme: { ...value.theme, [key]: Number(e.target.value) } })} /></label>)}<label>Submit button label<input value={value.theme.buttonLabel} onChange={e => change({ ...value, theme: { ...value.theme, buttonLabel: e.target.value } })} /></label></fieldset> : tab === 'Access' ? <fieldset disabled={readOnly} className="forms-builder-panel"><legend>Access, privacy and limits</legend>{['authenticated', 'saveProgress', 'autosaveProgress', 'analytics', 'analyticsConsent', 'publicResults'].map(key => <label className="forms-builder-check" key={key}><input type="checkbox" checked={value.access[key as 'authenticated']} onChange={e => change({ ...value, access: { ...value.access, [key]: e.target.checked } })} />{key.replace(/([A-Z])/g, ' $1')}</label>)}{['draftDays', 'retentionDays', 'ratePerMinute'].map(key => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" min={1} value={value.access[key as 'draftDays']} onChange={e => change({ ...value, access: { ...value.access, [key]: Number(e.target.value) } })} /></label>)}{['origins', 'embedOrigins'].map(key => <label key={key}>{key === 'origins' ? 'Allowed submission origins' : 'Allowed iframe hosts'} (one HTTPS origin per line)<textarea value={value.access[key as 'origins'].join('\n')} onChange={e => change({ ...value, access: { ...value.access, [key]: e.target.value.split('\n').filter(Boolean) } })} /></label>)}</fieldset> : tab === 'Publish' ? <section className="forms-builder-panel"><h3>Publish readiness</h3><p>Save Draft preserves your work without changing the live form. Publishing creates an immutable revision; previous entries retain their original field labels.</p>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}><button type="button" onClick={() => { if (issue.action && value.actions.find(action => action.id === issue.action)?.kind === 'email' && onEmailIssue) onEmailIssue(); else setTab(issue.action ? 'Actions' : issue.rule ? 'Logic' : 'Build'); setSelected(issue.field) }}>{fields.find(f => f.id === issue.field)?.label || 'Configuration'}: {issue.message}</button></li>)}</ul> : <p>The definition passes structural checks. Server permission and integration checks also run when publishing.</p>}<div className="forms-builder-actions">{onSave && <button type="button" disabled={readOnly} onClick={onSave}>Save Draft</button>}{onPublish && <button type="button" disabled={readOnly || issues.length > 0} onClick={onPublish}>Publish form</button>}</div>{children}</section> : <ActionsEditor mode={emailTarget === undefined ? 'all' : 'other'} integrations={integrations} local={local} postTypes={postTypes} payments={payments} definition={value} onChange={change} disabled={readOnly} />}
  {emailTarget && createPortal(<ActionsEditor mode="email" definition={value} onChange={change} disabled={readOnly} integrations={integrations} local={local} />, emailTarget)}
  {transferTarget === undefined ? transfer : transferTarget ? createPortal(transfer, transferTarget) : null}
  {inserter && <FormBuilderDialog title="Add Parts" variant="parts" centered anchor={insertionAnchor} close={() => { setInserter(false); setInsertion(undefined) }}><div className="forms-part-palette">{palette(false)}</div>{structureIssue && <p>{structureIssue}</p>}</FormBuilderDialog>}
  {expandedSettings && current && <FormBuilderDialog title={blockLabel(current) + ' settings'} variant="settings" anchor={settingsAnchor} centered close={() => setExpandedSettings(false)}>{settings}<button type="button" onClick={() => setExpandedSettings(false)}>Done</button></FormBuilderDialog>}
  {organizing && <FormBuilderDialog title="Organize into canvases" close={() => setOrganizing(false)}><p>Place the existing parts inside Canvas 1 and add an empty Canvas 2. Field IDs, values, settings, and order stay intact. Display mode stays unchanged. This is one undoable draft change.</p><button type="button" onClick={() => setOrganizing(false)}>Cancel</button><button type="button" disabled={readOnly || !!structureIssue} onClick={() => { const organized = organizeCanvases(value), canvas = newCanvas(organized.fields); change({ ...organized, fields: [...organized.fields, canvas] }); setSelection(canvas.id); setActiveCanvasID(canvas.id); setSidebar('List View'); setOrganizing(false) }}>Organize into canvases</button></FormBuilderDialog>}
  {menuPart && <FormBuilderDialog title={`Actions for ${blockLabel(menuPart)}`} close={() => setMenuID(undefined)}>{menuPart.id === virtualCanvasID ? <><p>This canvas displays existing top-level content without changing its storage.</p><button type="button" disabled={readOnly || !!structureIssue} onClick={() => { setMenuID(undefined); add('step') }}>Organize into canvases</button></> : <><button type="button" disabled={readOnly} onClick={() => { setSelected(menuPart.id); setMenuID(undefined); requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('.forms-settings input')?.focus()) }}>Rename</button><button type="button" disabled={readOnly} onClick={() => { duplicate(menuPart.id) }}>Duplicate</button><button type="button" disabled={readOnly} onClick={() => { shift(-1, menuPart.id); setMenuID(undefined) }}>Move up</button><button type="button" disabled={readOnly} onClick={() => { shift(1, menuPart.id); setMenuID(undefined) }}>Move down</button>{menuPart.kind !== 'step' && <label>Move to canvas<select disabled={readOnly} value="" onChange={event => { if (event.target.value) { move(menuPart.id, event.target.value); setMenuID(undefined) } }}><option value="">Choose canvas</option>{canvases.filter(canvas => canvas.id !== owningCanvas(value.fields, menuPart.id)).map(canvas => <option key={canvas.id} value={canvas.id}>{blockLabel(canvas)}</option>)}</select></label>}<button type="button" disabled={readOnly} onClick={() => { setDeleteID(menuPart.id); setMenuID(undefined) }}>Delete</button></>}</FormBuilderDialog>}
  {deletePart && removal && <FormBuilderDialog title={`Delete ${blockLabel(deletePart)}?`} close={() => setDeleteID(undefined)}><p>This removes this part and {flattenFields(deletePart.children || []).length} contained parts. Local rules affecting only removed parts are removed with them. You can undo this change.</p>{removal.blockers.length > 0 && <><p>Update these references before deleting:</p><ul>{removal.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul></>}<button type="button" onClick={() => setDeleteID(undefined)}>Cancel</button><button type="button" disabled={readOnly || removal.blockers.length > 0} onClick={() => { change(removal.definition); setSelection(undefined); setDeleteID(undefined) }}>Delete part</button></FormBuilderDialog>}
  </div>
}
