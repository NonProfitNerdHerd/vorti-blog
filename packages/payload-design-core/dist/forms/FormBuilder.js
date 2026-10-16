'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createPortal } from 'react-dom';
import { useId, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, pointerWithin, rectIntersection, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, Copy, Trash2, Undo2, Redo2, Monitor, Tablet, Smartphone, Plus } from 'lucide-react';
import { formFields } from './registry.js';
import { flattenFields, makeID } from './model.js';
import { validateDefinition } from './engine.js';
import { FormRenderer, fieldRenderers } from './FormRenderer.js';
import { LogicEditor } from './LogicEditor.js';
import { ActionsEditor } from './ActionsEditor.js';
import { DateSettings } from './DateSettings.js';
import { duplicateFormField } from './clone.js';
import { FormTransfer } from './FormTransfer.js';
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
function CanvasDrop({ device, children }) {
    const { setNodeRef, isOver } = useDroppable({ id: 'target:root' });
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
export function FormBuilder({ transferTarget, value, onChange, readOnly, saveStatus, onSave, onPublish, children, resources, payments, postTypes, integrations, local }) {
    const dragContextID = useId();
    const [tab, setTab] = useState('Build'), [selected, setSelected] = useState(() => value.fields.length === 1 && containers.includes(value.fields[0].kind) ? value.fields[0].id : undefined), [search, setSearch] = useState('');
    const [device, setDevice] = useState('desktop'), [preview, setPreview] = useState(false), [announcement, setAnnouncement] = useState('');
    const [history, setHistory] = useState([]), [future, setFuture] = useState([]);
    const [dragLabel, setDragLabel] = useState('');
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }));
    const fields = flattenFields(value.fields), current = fields.find(f => f.id === selected);
    const issues = validateDefinition(value);
    const change = (next) => { if (readOnly)
        return; setHistory(previous => [...previous, structuredClone(value)].slice(-100)); setFuture([]); onChange(next); };
    const update = (patch) => current && change({ ...value, fields: mapFields(value.fields, current.id, f => ({ ...f, ...patch })) });
    const add = (kind, target) => {
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
        const parent = current && fields.find(item => item.children?.some(child => child.id === current.id));
        const destination = target ? fields.find(item => item.id === target) : current && containers.includes(current.kind) ? current : parent;
        let next;
        if (destination && containers.includes(destination.kind))
            next = mapFields(value.fields, destination.id, parent => ({ ...parent, children: [...parent.children || [], field] }));
        else if (destination) {
            const before = (items) => items.flatMap(item => item.id === destination.id ? [field, item] : [{ ...item, ...(item.children ? { children: before(item.children) } : {}) }]);
            next = before(value.fields);
        }
        else
            next = [...value.fields, field];
        change({ ...value, fields: next });
        setSelected(field.id);
        setAnnouncement(`${field.label} added.`);
    };
    const move = (id, target) => {
        const field = fields.find(f => f.id === id), destination = fields.find(f => f.id === target);
        if (!field || id === target || flattenFields(field.children || []).some(f => f.id === target))
            return;
        let next = mapFields(value.fields, id, () => null);
        if (target === 'root')
            next = [...next, field];
        else if (destination && containers.includes(destination.kind))
            next = mapFields(next, target, f => ({ ...f, children: [...f.children || [], field] }));
        else {
            const before = (items) => items.flatMap(f => f.id === target ? [field, f] : [{ ...f, ...(f.children ? { children: before(f.children) } : {}) }]);
            next = before(next);
        }
        change({ ...value, fields: next });
        setAnnouncement(`${field.label} moved.`);
    };
    const shift = (delta) => {
        if (!current)
            return;
        const reorder = (items) => {
            const index = items.findIndex(f => f.id === current.id);
            if (index >= 0 && index + delta >= 0 && index + delta < items.length) {
                const next = [...items];
                [next[index], next[index + delta]] = [next[index + delta], next[index]];
                return next;
            }
            return items.map(f => ({ ...f, ...(f.children ? { children: reorder(f.children) } : {}) }));
        };
        change({ ...value, fields: reorder(value.fields) });
    };
    const draw = (field) => _jsx(FieldCard, { field: field, disabled: readOnly, selected: field.id === selected, select: () => setSelected(field.id), children: containers.includes(field.kind) ? _jsxs("div", { className: "forms-builder-grid", children: [field.children?.map(draw), !field.children?.length && _jsx("p", { children: "Select this group, then add fields from the palette." })] }) : _jsx("div", { className: "forms-card-preview", "aria-hidden": "true", children: field.kind === 'divider' ? _jsx("hr", {}) : ['heading', 'content'].includes(field.kind) ? _jsx("p", { children: field.help || field.label }) : field.options?.length ? field.options.map(o => _jsxs("span", { children: ["\u25CB ", o.label, " "] }, o.id)) : _jsx("div", { children: field.placeholder || 'Answer goes here' }) }) }, field.id);
    const textSetting = (label, key) => _jsxs("label", { children: [label, ['help', 'expression'].includes(key) ? _jsx("textarea", { value: String(current?.[key] || ''), onChange: e => update({ [key]: e.target.value }) }) : _jsx("input", { value: String(current?.[key] || ''), onChange: e => update({ [key]: e.target.value }) })] });
    const transfer = _jsx(FormTransfer, { expanded: transferTarget !== undefined, value: value, readOnly: readOnly, onImport: definition => { change(definition); setSelected(undefined); setAnnouncement('Imported form definition. Review settings before publishing.'); } });
    return _jsxs("div", { className: "forms-builder", children: [_jsxs("header", { className: "forms-builder-header", children: [_jsx("div", { role: "tablist", "aria-label": "Form settings", children: ['Build', 'Logic', 'Design', 'Actions', 'Access'].map(name => _jsx("button", { role: "tab", type: "button", "aria-selected": tab === name, onClick: () => { setTab(name); setPreview(false); }, children: name }, name)) }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", "aria-label": "Undo form change", disabled: readOnly || !history.length, onClick: () => { const previous = history.at(-1); if (previous) {
                                    setHistory(history.slice(0, -1));
                                    setFuture([...future, value]);
                                    onChange(previous);
                                } }, children: _jsx(Undo2, { size: 18 }) }), _jsx("button", { type: "button", "aria-label": "Redo form change", disabled: readOnly || !future.length, onClick: () => { const next = future.at(-1); if (next) {
                                    setFuture(future.slice(0, -1));
                                    setHistory([...history, value]);
                                    onChange(next);
                                } }, children: _jsx(Redo2, { size: 18 }) }), [['desktop', Monitor], ['tablet', Tablet], ['phone', Smartphone]].map(([name, Icon]) => { const Component = Icon; return _jsx("button", { type: "button", "aria-label": `${name} preview`, "aria-pressed": device === name, onClick: () => setDevice(String(name)), children: _jsx(Component, { size: 18 }) }, String(name)); }), _jsx("button", { type: "button", "aria-pressed": preview, onClick: () => setPreview(!preview), children: preview ? 'Return to builder' : 'Try form' }), _jsx("button", { type: "button", "aria-pressed": tab === 'Publish' && !preview, onClick: () => { setTab('Publish'); setPreview(false); }, children: "Publish" })] }), _jsx("div", { className: "forms-builder-save-status", role: "status", children: saveStatus })] }), _jsx("p", { className: "forms-sr-only", "aria-live": "polite", children: announcement }), tab === 'Build' && !preview ? _jsxs(DndContext, { id: dragContextID, sensors: sensors, collisionDetection: fieldCollision, onDragStart: event => setDragLabel(String(event.active.id).startsWith('palette:') ? formFields.get(String(event.active.id).slice(8))?.label || 'Field' : fields.find(field => field.id === event.active.id)?.label || 'Field'), onDragCancel: () => setDragLabel(''), onDragEnd: event => { setDragLabel(''); if (event.over) {
                    const id = String(event.active.id), target = String(event.over.id).replace('target:', '');
                    if (id.startsWith('palette:'))
                        add(id.slice(8), target);
                    else
                        move(id, target);
                } }, children: [_jsxs("div", { className: "forms-builder-workspace", children: [_jsxs("aside", { className: "forms-palette", children: [_jsx("h3", { children: "Add fields" }), _jsx("input", { type: "search", "aria-label": "Search fields", placeholder: "Search fields", value: search, onChange: e => setSearch(e.target.value) }), ['Basic', 'Choices', 'Dates', 'Advanced', 'Layout'].map(category => _jsxs("section", { children: [_jsx("h4", { children: category }), formFields.list().filter(f => f.category === category && `${f.label} ${f.description}`.toLowerCase().includes(search.toLowerCase())).map(f => _jsx(PaletteField, { kind: f.kind, label: f.label, description: f.description, disabled: readOnly, add: () => add(f.kind) }, f.kind))] }, category))] }), _jsxs(CanvasDrop, { device: device, children: [_jsx("div", { className: "forms-builder-grid", children: value.fields.map(draw) }), !value.fields.length && _jsx("div", { className: "forms-empty", children: _jsx("button", { type: "button", disabled: readOnly, onClick: () => { const group = { id: makeID(), kind: 'section', label: 'Group 1', width: 12, children: [] }; change({ ...value, fields: [group] }); setSelected(group.id); }, children: "Add first group" }) })] }), _jsxs("aside", { className: "forms-settings", children: [_jsx("h3", { children: "Field settings" }), current ? _jsxs("fieldset", { disabled: readOnly, children: [_jsx("legend", { children: current.label }), textSetting('Label', 'label'), _jsx("p", { children: _jsxs("small", { children: ["Stable ID: ", current.id, ". References use this ID even when the label changes."] }) }), _jsxs("label", { children: ["Width", _jsx("select", { value: current.width || 12, onChange: e => update({ width: Number(e.target.value) }), children: [[12, 'Full'], [6, 'Half'], [4, 'One third'], [8, 'Two thirds'], [3, 'One quarter'], [9, 'Three quarters']].map(([w, label]) => _jsx("option", { value: w, children: label }, w)) })] }), textSetting('Help text', 'help'), textSetting('Placeholder', 'placeholder'), _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: !!current.required, onChange: e => update({ required: e.target.checked }) }), "Required"] }), _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: !!current.sensitive, onChange: e => update({ sensitive: e.target.checked }) }), "Sensitive answer (restricted entry viewing)"] }), textSetting('Custom error message', 'errorMessage'), !formFields.get(current.kind)?.structural && fieldRenderers.has(current.kind) && !['upload', 'signature', 'repeater'].includes(current.kind) && _jsxs("details", { children: [_jsx("summary", { children: "Default answer" }), _jsx(FormRenderer, { definition: { ...value, fields: [{ ...current, required: false, id: 'sample' }], rules: [], actions: [], mode: 'standard', access: { ...value.access, analytics: false, saveProgress: false } }, initialAnswers: { sample: current.defaultValue ?? null }, preview: true, onChange: answers => update({ defaultValue: answers.sample }) })] }), current.kind === 'calculated' && _jsxs(_Fragment, { children: [textSetting('Calculation', 'expression'), _jsx("p", { children: "Use [field ID], + \u2212 * /, sum, min, max, round, abs and if. Example: round([quantity] * 12.50, 2)." }), _jsxs("label", { children: ["Currency code", _jsx("input", { value: current.currency || '', onChange: e => update({ currency: e.target.value.toUpperCase() || undefined }) })] })] }), (formFields.get(current.kind)?.numeric || current.kind === 'repeater') && ['min', 'max'].map(key => _jsxs("label", { children: [key === 'min' ? 'Minimum' : 'Maximum', _jsx("input", { type: "number", value: current[key] ?? '', onChange: e => update({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) })] }, key)), ['text', 'textarea'].includes(current.kind) && ['minLength', 'maxLength'].map(key => _jsxs("label", { children: [key === 'minLength' ? 'Minimum characters' : 'Maximum characters', _jsx("input", { type: "number", min: 0, value: current[key] ?? '', onChange: e => update({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) })] }, key)), formFields.get(current.kind)?.choices && _jsxs("fieldset", { children: [_jsx("legend", { children: "Options" }), current.options?.map((option, index) => _jsxs("div", { children: [_jsxs("label", { children: ["Option ", index + 1, _jsx("input", { value: option.label, onChange: e => update({ options: current.options?.map(o => o.id === option.id ? { ...o, label: e.target.value } : o) }) })] }), current.kind === 'imageChoice' && _jsxs("label", { children: ["Image URL", _jsx("input", { value: option.image || '', onChange: e => update({ options: current.options?.map(o => o.id === option.id ? { ...o, image: e.target.value } : o) }) })] }), _jsxs("button", { type: "button", onClick: () => update({ options: current.options?.filter(o => o.id !== option.id) }), children: ["Remove ", option.label] })] }, option.id)), _jsx("button", { type: "button", onClick: () => update({ options: [...current.options || [], { id: makeID('option'), label: 'New option', value: makeID('value') }] }), children: "Add option" })] }), current.kind === 'likert' && _jsxs("fieldset", { children: [_jsx("legend", { children: "Matrix rows" }), current.rows?.map(row => _jsxs("label", { children: ["Row", _jsx("input", { value: row.label, onChange: e => update({ rows: current.rows?.map(r => r.id === row.id ? { ...r, label: e.target.value } : r) }) })] }, row.id)), _jsx("button", { type: "button", onClick: () => update({ rows: [...current.rows || [], { id: makeID('row'), label: 'New row', value: makeID('value') }] }), children: "Add row" })] }), ['date', 'time', 'datetime', 'dateRange'].includes(current.kind) && _jsx(DateSettings, { resources: resources, value: current.date, kind: current.kind, onChange: date => update({ date }) }), current.kind === 'upload' && _jsxs("fieldset", { children: [_jsx("legend", { children: "Upload limits" }), _jsxs("label", { children: ["Maximum files", _jsx("input", { type: "number", min: 1, max: 20, value: current.files?.maxCount || 1, onChange: e => update({ files: { ...current.files, maxCount: Number(e.target.value) } }) })] }), _jsxs("label", { children: ["Maximum bytes per file", _jsx("input", { type: "number", min: 1, value: current.files?.maxBytes || 10485760, onChange: e => update({ files: { ...current.files, maxBytes: Number(e.target.value) } }) })] }), _jsxs("label", { children: ["Allowed MIME types (comma separated)", _jsx("input", { value: current.files?.mimeTypes.join(', ') || '', onChange: e => update({ files: { ...current.files, mimeTypes: e.target.value.split(',').map(s => s.trim()) } }) })] })] }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", onClick: () => shift(-1), children: "Move up" }), _jsx("button", { type: "button", onClick: () => shift(1), children: "Move down" }), _jsx("button", { type: "button", onClick: () => move(current.id, 'root'), children: "Move to top level" }), _jsxs("button", { type: "button", onClick: () => { const copy = duplicateFormField(value, current.id); change(copy.definition); setSelected(copy.selected); setAnnouncement(`${current.label} duplicated.`); }, children: [_jsx(Copy, { size: 16 }), "Duplicate"] }), _jsxs("button", { type: "button", onClick: () => { change({ ...value, fields: mapFields(value.fields, current.id, () => null) }); setSelected(undefined); }, children: [_jsx(Trash2, { size: 16 }), "Delete"] })] })] }) : _jsx("p", { children: "Select a canvas field to edit its settings." })] })] }), _jsx(DragOverlay, { dropAnimation: null, children: dragLabel ? _jsx("div", { className: "forms-drag-overlay", children: dragLabel }) : null })] }) : preview ? _jsx("div", { className: `forms-builder-preview forms-device-${device}`, children: _jsx(FormRenderer, { definition: value, preview: true, showLogic: true }) }) : tab === 'Logic' ? _jsx(LogicEditor, { definition: value, onChange: change, disabled: readOnly }) : tab === 'Design' ? _jsxs("fieldset", { disabled: readOnly, className: "forms-builder-panel", children: [_jsx("legend", { children: "Presentation" }), _jsxs("label", { children: ["Mode", _jsxs("select", { value: value.mode, onChange: e => change({ ...value, mode: e.target.value }), children: [_jsx("option", { value: "standard", children: "Standard" }), _jsx("option", { value: "steps", children: "Multi-step" }), _jsx("option", { value: "conversational", children: "Conversational" })] })] }), _jsxs("label", { children: ["Locale", _jsx("input", { value: value.locale, onChange: e => change({ ...value, locale: e.target.value }) })] }), _jsxs("label", { children: ["Direction", _jsxs("select", { value: value.direction, onChange: e => change({ ...value, direction: e.target.value }), children: [_jsx("option", { value: "ltr", children: "Left to right" }), _jsx("option", { value: "rtl", children: "Right to left" })] })] }), ['primary', 'background', 'text', 'border', 'error'].map(key => _jsxs("label", { children: [key, " color", _jsx("input", { type: "color", value: value.theme[key], onChange: e => change({ ...value, theme: { ...value.theme, [key]: e.target.value } }) })] }, key)), ['spacing', 'radius'].map(key => _jsxs("label", { children: [key, _jsx("input", { type: "number", min: 0, max: 64, value: value.theme[key], onChange: e => change({ ...value, theme: { ...value.theme, [key]: Number(e.target.value) } }) })] }, key)), _jsxs("label", { children: ["Submit button label", _jsx("input", { value: value.theme.buttonLabel, onChange: e => change({ ...value, theme: { ...value.theme, buttonLabel: e.target.value } }) })] })] }) : tab === 'Access' ? _jsxs("fieldset", { disabled: readOnly, className: "forms-builder-panel", children: [_jsx("legend", { children: "Access, privacy and limits" }), ['authenticated', 'saveProgress', 'autosaveProgress', 'analytics', 'analyticsConsent', 'publicResults'].map(key => _jsxs("label", { className: "forms-builder-check", children: [_jsx("input", { type: "checkbox", checked: value.access[key], onChange: e => change({ ...value, access: { ...value.access, [key]: e.target.checked } }) }), key.replace(/([A-Z])/g, ' $1')] }, key)), ['draftDays', 'retentionDays', 'ratePerMinute'].map(key => _jsxs("label", { children: [key.replace(/([A-Z])/g, ' $1'), _jsx("input", { type: "number", min: 1, value: value.access[key], onChange: e => change({ ...value, access: { ...value.access, [key]: Number(e.target.value) } }) })] }, key)), ['origins', 'embedOrigins'].map(key => _jsxs("label", { children: [key === 'origins' ? 'Allowed submission origins' : 'Allowed iframe hosts', " (one HTTPS origin per line)", _jsx("textarea", { value: value.access[key].join('\n'), onChange: e => change({ ...value, access: { ...value.access, [key]: e.target.value.split('\n').filter(Boolean) } }) })] }, key))] }) : tab === 'Publish' ? _jsxs("section", { className: "forms-builder-panel", children: [_jsx("h3", { children: "Publish readiness" }), _jsx("p", { children: "Save Draft preserves your work without changing the live form. Publishing creates an immutable revision; previous entries retain their original field labels." }), issues.length ? _jsx("ul", { children: issues.map((issue, index) => _jsx("li", { children: _jsxs("button", { type: "button", onClick: () => { setTab(issue.action ? 'Actions' : issue.rule ? 'Logic' : 'Build'); setSelected(issue.field); }, children: [fields.find(f => f.id === issue.field)?.label || 'Configuration', ": ", issue.message] }) }, index)) }) : _jsx("p", { children: "The definition passes structural checks. Server permission and integration checks also run when publishing." }), _jsxs("div", { className: "forms-builder-actions", children: [onSave && _jsx("button", { type: "button", disabled: readOnly, onClick: onSave, children: "Save Draft" }), onPublish && _jsx("button", { type: "button", disabled: readOnly || issues.length > 0, onClick: onPublish, children: "Publish form" })] }), children] }) : _jsx(ActionsEditor, { integrations: integrations, local: local, postTypes: postTypes, payments: payments, definition: value, onChange: change, disabled: readOnly }), transferTarget === undefined ? transfer : transferTarget ? createPortal(transfer, transferTarget) : null] });
}
