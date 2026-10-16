'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, pointerWithin, rectIntersection, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, Copy, Trash2, Undo2, Redo2, Monitor, Tablet, Smartphone, Plus, ListTree } from 'lucide-react';
import { formFields } from './registry.js';
import { flattenFields, makeID } from './model.js';
import { validateDefinition } from './engine.js';
import { FormRenderer, fieldRenderers } from './FormRenderer.js';
import { LogicEditor } from './LogicEditor.js';
import { ActionsEditor } from './ActionsEditor.js';
import { DateSettings } from './DateSettings.js';
import { duplicateFormField } from './clone.js';
import { FormTransfer } from './FormTransfer.js';
import { canvasItems, owningCanvas, virtualCanvasID, organizeCanvases, organizeIssue, newCanvas, movePart, deletionPlan } from './canvases.js';
import { FormHierarchy } from './FormHierarchy.js';
import { FormBuilderDialog } from './FormBuilderDialog.js';
import './builder.css';
const containers = ['row', 'section', 'step', 'repeater'];
const fieldCollision = args => {
    const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
    return hits.sort((a, b) => {
        const first = args.droppableRects.get(a.id), second = args.droppableRects.get(b.id);
        return (first ? first.width * first.height : Infinity) - (second ? second.width * second.height : Infinity);
    });
};
function PaletteField({ kind, label, description, disabled, add }) {
    const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `palette:${kind}`, disabled });
    return _jsxs("button", { type: "button", ref: setNodeRef, ...listeners, ...attributes, disabled: disabled, title: `${description} Click to add, or drag onto the canvas.`, onClick: add, style: { opacity: isDragging ? .5 : 1 }, children: [_jsx(Plus, { size: 14 }), label] });
}
function CanvasDrop({ device, target, children }) {
    const { setNodeRef, isOver } = useDroppable({ id: `target:${target}` });
    return _jsx("main", { "aria-label": "Form canvas", ref: setNodeRef, className: `forms-builder-canvas forms-device-${device} ${isOver ? 'is-drop' : ''}`, children: children });
}
function mapFields(fields, id, action) {
    return fields.flatMap(field => { if (field.id === id) {
        const next = action(field);
        return next ? [next] : [];
    } return [{ ...field, ...(field.children ? { children: mapFields(field.children, id, action) } : {}) }]; });
}
function FieldCard({ field, selected, select, children, disabled }) {
    const { setNodeRef: setDragNode, listeners, attributes, isDragging } = useDraggable({ id: field.id, disabled });
    const { setNodeRef: setDropNode, isOver } = useDroppable({ id: `target:${field.id}` });
    return _jsxs("div", { ref: setDropNode, className: `forms-canvas-card ${selected ? 'is-selected' : ''} ${isOver ? 'is-drop' : ''}`, style: { gridColumn: `span ${field.width || 12}`, opacity: isDragging ? .4 : 1 }, children: [_jsxs("div", { className: "forms-canvas-card-title", children: [_jsx("button", { type: "button", ref: setDragNode, ...listeners, ...attributes, disabled: disabled, "aria-label": `Drag ${field.label}`, children: _jsx(GripVertical, { size: 16 }) }), _jsxs("button", { type: "button", onClick: select, "aria-pressed": selected, children: [field.label || 'Untitled field', _jsx("small", { children: formFields.get(field.kind)?.label })] })] }), children] });
}
export function FormBuilder({ navigationTarget, navigation, toolbarTarget, emailTarget, onEmailIssue, transferTarget, value, onChange, readOnly, saveStatus, onSave, onPublish, children, resources, payments, postTypes, integrations, local }) {
    const dragContextID = useId();
    const [localView, setLocalView] = useState('Build');
    const tab = navigation?.view ?? localView;
    const setTab = (view) => navigation ? navigation.onChange(view) : setLocalView(view);
    const preview = tab === 'Preview';
    const previousView = useRef('Build');
    const togglePreview = () => { if (preview)
        setTab(previousView.current);
    else {
        previousView.current = tab;
        setTab('Preview');
    } };
    const [selected, setSelection] = useState(() => value.fields.length === 1 && containers.includes(value.fields[0].kind) ? value.fields[0].id : undefined), [search, setSearch] = useState('');
    const [device, setDevice] = useState('desktop'), [announcement, setAnnouncement] = useState('');
    const [history, setHistory] = useState([]), [future, setFuture] = useState([]);
    const [dragLabel, setDragLabel] = useState('');
    const [activeCanvasID, setActiveCanvasID] = useState();
    const [sidebar, setSidebar] = useState('List View');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [mobile, setMobile] = useState(false);
    useEffect(() => {
        if (!window.matchMedia)
            return;
        const media = window.matchMedia('(max-width: 700px)');
        const update = () => { setMobile(media.matches); setSidebarOpen(!media.matches); };
        const frame = requestAnimationFrame(update);
        media.addEventListener('change', update);
        return () => { cancelAnimationFrame(frame); media.removeEventListener('change', update); };
    }, []);
    const [inserter, setInserter] = useState(false);
    const insertButton = useRef(null), root = useRef(null);
    const [menuID, setMenuID] = useState();
    const [deleteID, setDeleteID] = useState();
    const [organizing, setOrganizing] = useState(false);
    const canvases = canvasItems(value.fields);
    const activeCanvas = canvases.find(canvas => canvas.id === (owningCanvas(value.fields, selected) || activeCanvasID)) || canvases[0];
    const setSelected = (id) => { setSelection(id); const owner = owningCanvas(value.fields, id); if (owner)
        setActiveCanvasID(owner); if (mobile)
        setSidebarOpen(false); };
    const menuPart = canvases.find(part => part.id === menuID) || flattenFields(value.fields).find(part => part.id === menuID);
    const deletePart = flattenFields(value.fields).find(part => part.id === deleteID);
    const removal = deleteID ? deletionPlan(value, deleteID) : undefined;
    const structureIssue = organizeIssue(value.fields);
    const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }));
    const fields = flattenFields(value.fields), current = fields.find(f => f.id === (selected || activeCanvas.id));
    const issues = validateDefinition(value);
    const change = (next) => { if (readOnly)
        return; setHistory(previous => [...previous, structuredClone(value)].slice(-100)); setFuture([]); onChange(next); };
    const update = (patch) => current && change({ ...value, fields: mapFields(value.fields, current.id, f => ({ ...f, ...patch })) });
    const add = (kind, target) => {
        if (readOnly)
            return;
        if (mobile)
            setSidebarOpen(false);
        if (kind === 'step') {
            setInserter(false);
            if (structureIssue) {
                setAnnouncement(structureIssue);
                return;
            }
            if (value.fields.some(field => field.kind !== 'step')) {
                setOrganizing(true);
                return;
            }
            const canvas = newCanvas(value.fields);
            change({ ...value, fields: [...value.fields, canvas] });
            setActiveCanvasID(canvas.id);
            setSelection(canvas.id);
            setSidebar('List View');
            setAnnouncement(canvas.label + ' added.');
            return;
        }
        const definition = formFields.get(kind), field = { id: makeID(), kind, label: definition.label, width: 12 };
        if (definition.choices)
            field.options = ['First option', 'Second option', 'Third option'].map((label, i) => ({ id: makeID('option'), label, value: String(i + 1) }));
        if (kind === 'likert')
            field.rows = ['Service', 'Quality'].map(label => ({ id: makeID('row'), label, value: label }));
        if (containers.includes(kind))
            field.children = [];
        if (kind === 'calculated')
            field.expression = '0';
        if (kind === 'upload')
            field.files = { maxCount: 3, maxBytes: 10 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] };
        if (kind === 'datetime')
            field.date = { timezone: 'UTC' };
        const destination = target ? fields.find(item => item.id === target) : current || (activeCanvas.id !== virtualCanvasID ? activeCanvas : undefined);
        let next;
        if (destination && containers.includes(destination.kind))
            next = mapFields(value.fields, destination.id, parent => ({ ...parent, children: [...parent.children || [], field] }));
        else if (destination) {
            const before = (items) => items.flatMap(item => item.id === destination.id ? (target ? [field, item] : [item, field]) : [{ ...item, ...(item.children ? { children: before(item.children) } : {}) }]);
            next = before(value.fields);
        }
        else
            next = [...value.fields, field];
        change({ ...value, fields: next });
        setSelection(field.id);
        setActiveCanvasID(owningCanvas(next, field.id));
        setInserter(false);
        setAnnouncement(`${field.label} added.`);
    };
    const move = (id, target) => {
        if (readOnly)
            return;
        const next = movePart(value.fields, id, target);
        if (next === value.fields) {
            setAnnouncement('Choose a valid destination. Canvases must remain at the top level.');
            return;
        }
        change({ ...value, fields: next });
        setSelection(id);
        setActiveCanvasID(owningCanvas(next, id));
        setAnnouncement('Part moved.');
    };
    const shift = (delta, id = current?.id) => {
        if (!id || readOnly)
            return;
        const reorder = (items) => {
            const index = items.findIndex(f => f.id === id);
            if (index >= 0 && index + delta >= 0 && index + delta < items.length) {
                const next = [...items];
                [next[index], next[index + delta]] = [next[index + delta], next[index]];
                return next;
            }
            return items.map(f => ({ ...f, ...(f.children ? { children: reorder(f.children) } : {}) }));
        };
        change({ ...value, fields: reorder(value.fields) });
    };
    const draw = (field) => _jsx(FieldCard, { field: field, disabled: readOnly, selected: field.id === selected, select: () => setSelected(field.id), children: containers.includes(field.kind) ? _jsxs("div", { className: "forms-builder-grid", children: [field.children?.map(draw), !field.children?.length && _jsx("p", { children: "Select this group, then add parts." })] }) : _jsx("div", { className: "forms-card-preview", "aria-hidden": "true", children: field.kind === 'divider' ? _jsx("hr", {}) : ['heading', 'content'].includes(field.kind) ? _jsx("p", { children: field.help || field.label }) : field.options?.length ? field.options.map(o => _jsxs("span", { children: ["\u25CB ", o.label, " "] }, o.id)) : _jsx("div", { children: field.placeholder || 'Answer goes here' }) }) }, field.id);
    const textSetting = (label, key) => _jsxs("label", { children: [label, ['help', 'expression'].includes(key) ? _jsx("textarea", { value: String(current?.[key] || ''), onChange: e => update({ [key]: e.target.value }) }) : _jsx("input", { value: String(current?.[key] || ''), onChange: e => update({ [key]: e.target.value }) })] });
    const palette = (draggable) => _jsxs(_Fragment, { children: [_jsx("input", { type: "search", "aria-label": "Search parts", placeholder: "Search parts", value: search, onChange: event => setSearch(event.target.value) }), ['Basic', 'Choices', 'Dates', 'Advanced', 'Layout'].map(category => _jsxs("section", { children: [_jsx("h4", { children: category }), formFields.list().filter(part => part.category === category && (part.label + ' ' + part.description).toLowerCase().includes(search.toLowerCase())).map(part => draggable ? _jsx(PaletteField, { kind: part.kind, label: part.label, description: part.description, disabled: readOnly || (part.kind === 'step' && !!structureIssue), add: () => add(part.kind) }, part.kind) : _jsxs("button", { type: "button", disabled: readOnly || (part.kind === 'step' && !!structureIssue), onClick: () => add(part.kind), children: [_jsx(Plus, { size: 14 }), part.label] }, part.kind))] }, category))] });
    const sidebarPanel = _jsxs("aside", { className: "forms-palette forms-sidebar", "aria-label": "Form parts sidebar", children: [_jsx("div", { role: "tablist", "aria-label": "Form parts navigation", children: ['List View', 'Add Parts'].map(name => _jsx("button", { role: "tab", type: "button", "aria-selected": sidebar === name, onClick: () => setSidebar(name), onKeyDown: event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                        event.preventDefault();
                        setSidebar(sidebar === 'List View' ? 'Add Parts' : 'List View');
                        event.currentTarget.parentElement?.querySelectorAll('button')[sidebar === 'List View' ? 1 : 0]?.focus();
                    } }, children: name }, name)) }), sidebar === 'List View' ? _jsx(FormHierarchy, { canvases: canvases, selected: selected || activeCanvas.id, select: setSelected, menu: setMenuID, readOnly: readOnly }) : _jsx("div", { className: "forms-part-palette", children: palette(true) }), structureIssue && _jsx("p", { role: "status", children: structureIssue }), _jsx("button", { type: "button", disabled: readOnly || !!structureIssue, onClick: () => add('step'), children: "Add Canvas" })] });
    const navigationControls = _jsxs("div", { className: "forms-builder forms-navigation-controls", children: [_jsx("button", { ref: insertButton, type: "button", "aria-label": "Add parts", "aria-haspopup": "dialog", "aria-expanded": inserter, disabled: readOnly, onClick: () => { setTab('Build'); setInserter(true); }, children: _jsx(Plus, { size: 18 }) }), _jsx("button", { type: "button", "aria-label": "Toggle form List View", "aria-pressed": sidebarOpen, onClick: () => { setTab('Build'); setSidebar('List View'); setSidebarOpen(!sidebarOpen); }, children: _jsx(ListTree, { size: 18 }) })] });
    const transfer = _jsx(FormTransfer, { expanded: transferTarget !== undefined, value: value, readOnly: readOnly, onImport: definition => { change(definition); setSelected(undefined); setAnnouncement('Imported form definition. Review settings before publishing.'); } });
    const toolbar = _jsxs("header", { className: "forms-builder-header", "aria-label": "Form builder controls", children: [!navigation && _jsx("div", { role: "tablist", "aria-label": "Form settings", children: ['Build', 'Logic', 'Design', 'Actions', 'Access'].map(name => _jsx("button", { role: "tab", type: "button", "aria-selected": tab === name, onClick: () => { setTab(name); }, children: name }, name)) }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", "aria-label": "Undo form change", disabled: readOnly || !history.length, onClick: () => { const previous = history.at(-1); if (previous) {
                            setHistory(history.slice(0, -1));
                            setFuture([...future, value]);
                            onChange(previous);
                        } }, children: _jsx(Undo2, { size: 18 }) }), _jsx("button", { type: "button", "aria-label": "Redo form change", disabled: readOnly || !future.length, onClick: () => { const next = future.at(-1); if (next) {
                            setFuture(future.slice(0, -1));
                            setHistory([...history, value]);
                            onChange(next);
                        } }, children: _jsx(Redo2, { size: 18 }) }), [['desktop', Monitor], ['tablet', Tablet], ['phone', Smartphone]].map(([name, Icon]) => { const Component = Icon; return _jsx("button", { type: "button", "aria-label": `${name} preview`, "aria-pressed": device === name, onClick: () => setDevice(String(name)), children: _jsx(Component, { size: 18 }) }, String(name)); }), _jsx("button", { type: "button", "aria-pressed": preview, onClick: togglePreview, children: preview ? 'Return to builder' : 'Try form' }), _jsx("button", { type: "button", "aria-pressed": tab === 'Publish' && !preview, onClick: () => { setTab('Publish'); }, children: "Publish" })] }), _jsx("div", { className: "forms-builder-save-status", role: "status", children: saveStatus })] });
    return _jsxs("div", { ref: root, className: "forms-builder", "data-workspace-view": tab, children: [navigationTarget === undefined ? navigationControls : navigationTarget ? createPortal(navigationControls, navigationTarget) : null, toolbarTarget === undefined ? toolbar : toolbarTarget ? createPortal(toolbar, toolbarTarget) : null, _jsx("p", { className: "forms-sr-only", "aria-live": "polite", children: announcement }), tab === 'Build' && !preview ? _jsxs(DndContext, { id: dragContextID, sensors: sensors, collisionDetection: fieldCollision, onDragStart: event => setDragLabel(String(event.active.id).startsWith('palette:') ? formFields.get(String(event.active.id).slice(8))?.label || 'Part' : fields.find(field => field.id === String(event.active.id).replace('list:', ''))?.label || 'Field'), onDragCancel: () => setDragLabel(''), onDragEnd: event => { setDragLabel(''); if (event.over) {
                    const id = String(event.active.id), target = String(event.over.id).replace(/^(listtarget:|target:)/, '');
                    if (id.startsWith('palette:'))
                        add(id.slice(8), target);
                    else
                        move(id.replace('list:', ''), target);
                } }, children: [_jsxs("div", { className: `forms-builder-workspace ${sidebarOpen ? '' : 'forms-sidebar-closed'}`, children: [sidebarOpen && (mobile ? _jsx(FormBuilderDialog, { title: "Form parts", close: () => setSidebarOpen(false), children: sidebarPanel }) : sidebarPanel), _jsxs(CanvasDrop, { device: device, target: activeCanvas.id, children: [_jsx("h3", { children: _jsx("button", { type: "button", onClick: () => setSelected(activeCanvas.id), children: activeCanvas.label }) }), _jsx("div", { className: "forms-builder-grid", children: activeCanvas.children?.map(draw) }), !activeCanvas.children?.length && _jsxs("div", { className: "forms-empty", children: [_jsx("p", { children: activeCanvas.id === virtualCanvasID ? 'Add a Canvas to begin, or add a part to the existing form.' : 'This canvas is empty. Add parts here.' }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => activeCanvas.id === virtualCanvasID ? add('step') : setInserter(true), children: activeCanvas.id === virtualCanvasID ? 'Add first Canvas' : 'Add parts to canvas' })] })] }), _jsxs("aside", { className: "forms-settings", children: [_jsx("h3", { children: current?.kind === 'step' ? 'Canvas settings' : 'Field settings' }), current ? _jsxs("fieldset", { disabled: readOnly, children: [_jsx("legend", { children: current.label }), textSetting('Label', 'label'), _jsx("p", { children: _jsxs("small", { children: ["Stable ID: ", current.id, ". References use this ID even when the label changes."] }) }), _jsxs("label", { children: ["Width", _jsx("select", { value: current.width || 12, onChange: e => update({ width: Number(e.target.value) }), children: [[12, 'Full'], [6, 'Half'], [4, 'One third'], [8, 'Two thirds'], [3, 'One quarter'], [9, 'Three quarters']].map(([w, label]) => _jsx("option", { value: w, children: label }, w)) })] }), textSetting('Help text', 'help'), textSetting('Placeholder', 'placeholder'), _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: !!current.required, onChange: e => update({ required: e.target.checked }) }), "Required"] }), _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: !!current.sensitive, onChange: e => update({ sensitive: e.target.checked }) }), "Sensitive answer (restricted entry viewing)"] }), textSetting('Custom error message', 'errorMessage'), !formFields.get(current.kind)?.structural && fieldRenderers.has(current.kind) && !['upload', 'signature', 'repeater'].includes(current.kind) && _jsxs("details", { children: [_jsx("summary", { children: "Default answer" }), _jsx(FormRenderer, { definition: { ...value, fields: [{ ...current, required: false, id: 'sample' }], rules: [], actions: [], mode: 'standard', access: { ...value.access, analytics: false, saveProgress: false } }, initialAnswers: { sample: current.defaultValue ?? null }, preview: true, onChange: answers => update({ defaultValue: answers.sample }) })] }), current.kind === 'calculated' && _jsxs(_Fragment, { children: [textSetting('Calculation', 'expression'), _jsx("p", { children: "Use [field ID], + \u2212 * /, sum, min, max, round, abs and if. Example: round([quantity] * 12.50, 2)." }), _jsxs("label", { children: ["Currency code", _jsx("input", { value: current.currency || '', onChange: e => update({ currency: e.target.value.toUpperCase() || undefined }) })] })] }), (formFields.get(current.kind)?.numeric || current.kind === 'repeater') && ['min', 'max'].map(key => _jsxs("label", { children: [key === 'min' ? 'Minimum' : 'Maximum', _jsx("input", { type: "number", value: current[key] ?? '', onChange: e => update({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) })] }, key)), ['text', 'textarea'].includes(current.kind) && ['minLength', 'maxLength'].map(key => _jsxs("label", { children: [key === 'minLength' ? 'Minimum characters' : 'Maximum characters', _jsx("input", { type: "number", min: 0, value: current[key] ?? '', onChange: e => update({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) })] }, key)), formFields.get(current.kind)?.choices && _jsxs("fieldset", { children: [_jsx("legend", { children: "Options" }), current.options?.map((option, index) => _jsxs("div", { children: [_jsxs("label", { children: ["Option ", index + 1, _jsx("input", { value: option.label, onChange: e => update({ options: current.options?.map(o => o.id === option.id ? { ...o, label: e.target.value } : o) }) })] }), current.kind === 'imageChoice' && _jsxs("label", { children: ["Image URL", _jsx("input", { value: option.image || '', onChange: e => update({ options: current.options?.map(o => o.id === option.id ? { ...o, image: e.target.value } : o) }) })] }), _jsxs("button", { type: "button", onClick: () => update({ options: current.options?.filter(o => o.id !== option.id) }), children: ["Remove ", option.label] })] }, option.id)), _jsx("button", { type: "button", onClick: () => update({ options: [...current.options || [], { id: makeID('option'), label: 'New option', value: makeID('value') }] }), children: "Add option" })] }), current.kind === 'likert' && _jsxs("fieldset", { children: [_jsx("legend", { children: "Matrix rows" }), current.rows?.map(row => _jsxs("label", { children: ["Row", _jsx("input", { value: row.label, onChange: e => update({ rows: current.rows?.map(r => r.id === row.id ? { ...r, label: e.target.value } : r) }) })] }, row.id)), _jsx("button", { type: "button", onClick: () => update({ rows: [...current.rows || [], { id: makeID('row'), label: 'New row', value: makeID('value') }] }), children: "Add row" })] }), ['date', 'time', 'datetime', 'dateRange'].includes(current.kind) && _jsx(DateSettings, { resources: resources, value: current.date, kind: current.kind, onChange: date => update({ date }) }), current.kind === 'upload' && _jsxs("fieldset", { children: [_jsx("legend", { children: "Upload limits" }), _jsxs("label", { children: ["Maximum files", _jsx("input", { type: "number", min: 1, max: 20, value: current.files?.maxCount || 1, onChange: e => update({ files: { ...current.files, maxCount: Number(e.target.value) } }) })] }), _jsxs("label", { children: ["Maximum bytes per file", _jsx("input", { type: "number", min: 1, value: current.files?.maxBytes || 10485760, onChange: e => update({ files: { ...current.files, maxBytes: Number(e.target.value) } }) })] }), _jsxs("label", { children: ["Allowed MIME types (comma separated)", _jsx("input", { value: current.files?.mimeTypes.join(', ') || '', onChange: e => update({ files: { ...current.files, mimeTypes: e.target.value.split(',').map(s => s.trim()) } }) })] })] }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", onClick: () => shift(-1), children: "Move up" }), _jsx("button", { type: "button", onClick: () => shift(1), children: "Move down" }), _jsx("button", { type: "button", onClick: () => move(current.id, 'root'), children: "Move to top level" }), _jsxs("button", { type: "button", onClick: () => { const copy = duplicateFormField(value, current.id); change(copy.definition); setSelection(copy.selected); setActiveCanvasID(owningCanvas(copy.definition.fields, copy.selected)); setAnnouncement(`${current.label} duplicated.`); }, children: [_jsx(Copy, { size: 16 }), "Duplicate"] }), _jsxs("button", { type: "button", onClick: () => setDeleteID(current.id), children: [_jsx(Trash2, { size: 16 }), "Delete"] })] })] }) : _jsx("p", { children: "Select a canvas field to edit its settings." })] })] }), _jsx(DragOverlay, { dropAnimation: null, children: dragLabel ? _jsx("div", { className: "forms-drag-overlay", children: dragLabel }) : null })] }) : preview ? _jsx("div", { className: `forms-builder-preview forms-device-${device}`, children: _jsx(FormRenderer, { definition: value, preview: true, showLogic: true }) }) : tab === 'Logic' ? _jsx(LogicEditor, { definition: value, onChange: change, disabled: readOnly }) : tab === 'Design' ? _jsxs("fieldset", { disabled: readOnly, className: "forms-builder-panel", children: [_jsx("legend", { children: "Presentation" }), _jsxs("label", { children: ["Mode", _jsxs("select", { value: value.mode, onChange: e => change({ ...value, mode: e.target.value }), children: [_jsx("option", { value: "standard", children: "Standard" }), _jsx("option", { value: "steps", children: "Multi-step" }), _jsx("option", { value: "conversational", children: "Conversational" })] })] }), _jsxs("label", { children: ["Locale", _jsx("input", { value: value.locale, onChange: e => change({ ...value, locale: e.target.value }) })] }), _jsxs("label", { children: ["Direction", _jsxs("select", { value: value.direction, onChange: e => change({ ...value, direction: e.target.value }), children: [_jsx("option", { value: "ltr", children: "Left to right" }), _jsx("option", { value: "rtl", children: "Right to left" })] })] }), ['primary', 'background', 'text', 'border', 'error'].map(key => _jsxs("label", { children: [key, " color", _jsx("input", { type: "color", value: value.theme[key], onChange: e => change({ ...value, theme: { ...value.theme, [key]: e.target.value } }) })] }, key)), ['spacing', 'radius'].map(key => _jsxs("label", { children: [key, _jsx("input", { type: "number", min: 0, max: 64, value: value.theme[key], onChange: e => change({ ...value, theme: { ...value.theme, [key]: Number(e.target.value) } }) })] }, key)), _jsxs("label", { children: ["Submit button label", _jsx("input", { value: value.theme.buttonLabel, onChange: e => change({ ...value, theme: { ...value.theme, buttonLabel: e.target.value } }) })] })] }) : tab === 'Access' ? _jsxs("fieldset", { disabled: readOnly, className: "forms-builder-panel", children: [_jsx("legend", { children: "Access, privacy and limits" }), ['authenticated', 'saveProgress', 'autosaveProgress', 'analytics', 'analyticsConsent', 'publicResults'].map(key => _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: value.access[key], onChange: e => change({ ...value, access: { ...value.access, [key]: e.target.checked } }) }), key.replace(/([A-Z])/g, ' $1')] }, key)), ['draftDays', 'retentionDays', 'ratePerMinute'].map(key => _jsxs("label", { children: [key.replace(/([A-Z])/g, ' $1'), _jsx("input", { type: "number", min: 1, value: value.access[key], onChange: e => change({ ...value, access: { ...value.access, [key]: Number(e.target.value) } }) })] }, key)), ['origins', 'embedOrigins'].map(key => _jsxs("label", { children: [key === 'origins' ? 'Allowed submission origins' : 'Allowed iframe hosts', " (one HTTPS origin per line)", _jsx("textarea", { value: value.access[key].join('\n'), onChange: e => change({ ...value, access: { ...value.access, [key]: e.target.value.split('\n').filter(Boolean) } }) })] }, key))] }) : tab === 'Publish' ? _jsxs("section", { className: "forms-builder-panel", children: [_jsx("h3", { children: "Publish readiness" }), _jsx("p", { children: "Save Draft preserves your work without changing the live form. Publishing creates an immutable revision; previous entries retain their original field labels." }), issues.length ? _jsx("ul", { children: issues.map((issue, index) => _jsx("li", { children: _jsxs("button", { type: "button", onClick: () => { if (issue.action && value.actions.find(action => action.id === issue.action)?.kind === 'email' && onEmailIssue)
                                    onEmailIssue();
                                else
                                    setTab(issue.action ? 'Actions' : issue.rule ? 'Logic' : 'Build'); setSelected(issue.field); }, children: [fields.find(f => f.id === issue.field)?.label || 'Configuration', ": ", issue.message] }) }, index)) }) : _jsx("p", { children: "The definition passes structural checks. Server permission and integration checks also run when publishing." }), _jsxs("div", { className: "forms-builder-actions", children: [onSave && _jsx("button", { type: "button", disabled: readOnly, onClick: onSave, children: "Save Draft" }), onPublish && _jsx("button", { type: "button", disabled: readOnly || issues.length > 0, onClick: onPublish, children: "Publish form" })] }), children] }) : _jsx(ActionsEditor, { mode: emailTarget === undefined ? 'all' : 'other', integrations: integrations, local: local, postTypes: postTypes, payments: payments, definition: value, onChange: change, disabled: readOnly }), emailTarget && createPortal(_jsx(ActionsEditor, { mode: "email", definition: value, onChange: change, disabled: readOnly, integrations: integrations, local: local }), emailTarget), transferTarget === undefined ? transfer : transferTarget ? createPortal(transfer, transferTarget) : null, inserter && _jsxs(FormBuilderDialog, { title: "Add Parts", anchor: insertButton, close: () => setInserter(false), children: [_jsx("div", { className: "forms-part-palette", children: palette(false) }), structureIssue && _jsx("p", { children: structureIssue })] }), organizing && _jsxs(FormBuilderDialog, { title: "Organize into canvases", close: () => setOrganizing(false), children: [_jsx("p", { children: "Place the existing parts inside Canvas 1 and add an empty Canvas 2. Field IDs, values, settings, and order stay intact. Display mode stays unchanged. This is one undoable draft change." }), _jsx("button", { type: "button", onClick: () => setOrganizing(false), children: "Cancel" }), _jsx("button", { type: "button", disabled: readOnly || !!structureIssue, onClick: () => { const organized = organizeCanvases(value), canvas = newCanvas(organized.fields); change({ ...organized, fields: [...organized.fields, canvas] }); setSelection(canvas.id); setActiveCanvasID(canvas.id); setSidebar('List View'); setOrganizing(false); }, children: "Organize into canvases" })] }), menuPart && _jsx(FormBuilderDialog, { title: `Actions for ${menuPart.label}`, close: () => setMenuID(undefined), children: menuPart.id === virtualCanvasID ? _jsxs(_Fragment, { children: [_jsx("p", { children: "This canvas displays existing top-level content without changing its storage." }), _jsx("button", { type: "button", disabled: readOnly || !!structureIssue, onClick: () => { setMenuID(undefined); add('step'); }, children: "Organize into canvases" })] }) : _jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: readOnly, onClick: () => { setSelected(menuPart.id); setMenuID(undefined); requestAnimationFrame(() => root.current?.querySelector('.forms-settings input')?.focus()); }, children: "Rename" }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => { const copy = duplicateFormField(value, menuPart.id); change(copy.definition); setSelection(copy.selected); setActiveCanvasID(owningCanvas(copy.definition.fields, copy.selected)); setMenuID(undefined); }, children: "Duplicate" }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => { shift(-1, menuPart.id); setMenuID(undefined); }, children: "Move up" }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => { shift(1, menuPart.id); setMenuID(undefined); }, children: "Move down" }), menuPart.kind !== 'step' && _jsxs("label", { children: ["Move to canvas", _jsxs("select", { disabled: readOnly, value: "", onChange: event => { if (event.target.value) {
                                        move(menuPart.id, event.target.value);
                                        setMenuID(undefined);
                                    } }, children: [_jsx("option", { value: "", children: "Choose canvas" }), canvases.filter(canvas => canvas.id !== owningCanvas(value.fields, menuPart.id)).map(canvas => _jsx("option", { value: canvas.id, children: canvas.label }, canvas.id))] })] }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => { setDeleteID(menuPart.id); setMenuID(undefined); }, children: "Delete" })] }) }), deletePart && removal && _jsxs(FormBuilderDialog, { title: `Delete ${deletePart.label}?`, close: () => setDeleteID(undefined), children: [_jsxs("p", { children: ["This removes this part and ", flattenFields(deletePart.children || []).length, " contained parts. Local rules affecting only removed parts are removed with them. You can undo this change."] }), removal.blockers.length > 0 && _jsxs(_Fragment, { children: [_jsx("p", { children: "Update these references before deleting:" }), _jsx("ul", { children: removal.blockers.map((message, index) => _jsx("li", { children: message }, index)) })] }), _jsx("button", { type: "button", onClick: () => setDeleteID(undefined), children: "Cancel" }), _jsx("button", { type: "button", disabled: readOnly || removal.blockers.length > 0, onClick: () => { change(removal.definition); setSelection(undefined); setDeleteID(undefined); }, children: "Delete part" })] })] });
}
