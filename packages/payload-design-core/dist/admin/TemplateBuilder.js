'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and reactive drag state as hook return values. */
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui';
import { useEffect, useRef, useState } from 'react';
import { coreEditorElements, editorCategoryLabels, searchEditorElements, toLibraryItem } from '../editor-registry.js';
import { insertTemplateNode, moveTemplateNode, moveTemplateNodeTo, removeTemplateNode, updateTemplateNode } from '../template-tree.js';
let pendingLibraryPointerItem = null;
const layoutItems = coreEditorElements.filter((item) => item.kind === 'layout').map(toLibraryItem);
const fieldItems = coreEditorElements.filter((item) => item.kind === 'field').map(toLibraryItem);
const panel = { border: '1px solid var(--theme-elevation-150)', borderRadius: 8, padding: '1rem' };
const relationID = (value) => typeof value === 'string' || typeof value === 'number' ? value : value && typeof value === 'object' && 'id' in value ? value.id : undefined;
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
async function fetchDocs(url) { const response = await fetch(url, { credentials: 'same-origin' }); if (!response.ok)
    return []; const body = await response.json(); return body.docs ?? []; }
function LibraryButton({ item, add }) {
    return _jsxs("div", { style: { display: 'flex', gap: 4, marginBottom: 4 }, children: [_jsx("button", { type: "button", draggable: true, "aria-label": `Drag ${item.label}`, onPointerDown: () => { pendingLibraryPointerItem = item; }, onPointerCancel: () => { pendingLibraryPointerItem = null; }, onDragStart: (event) => { const serialized = JSON.stringify(item); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-template-library', serialized); event.dataTransfer.setData('text/plain', serialized); }, style: { cursor: 'grab', touchAction: 'none' }, children: "\u283F" }), _jsx("button", { type: "button", onClick: add, style: { flex: 1, textAlign: 'left' }, children: item.label })] });
}
function DropArea({ id, label, children, add, addItem }) {
    const drop = useDroppable({ id: `container:${id}`, data: { containerID: id } });
    return _jsxs("div", { style: { minHeight: 60, padding: 8, border: '1px solid var(--theme-elevation-150)', borderRadius: 6 }, children: [_jsx("div", { ref: drop.setNodeRef, "aria-label": label, onPointerUp: () => { if (pendingLibraryPointerItem && addItem)
                    addItem(pendingLibraryPointerItem); pendingLibraryPointerItem = null; }, onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }, onDrop: (event) => { const value = event.dataTransfer.getData('application/x-template-library') || event.dataTransfer.getData('text/plain'); if (!value || !addItem)
                    return; event.preventDefault(); pendingLibraryPointerItem = null; try {
                    addItem(JSON.parse(value));
                }
                catch { /* ignore invalid external drag data */ } }, style: { minHeight: 34, display: 'grid', placeItems: 'center', marginBottom: children ? 8 : 0, border: `1px dashed ${drop.isOver ? 'var(--theme-success-500)' : 'var(--theme-elevation-250)'}`, background: drop.isOver ? 'var(--theme-success-50)' : 'transparent', borderRadius: 6 }, children: add && _jsx("button", { type: "button", "aria-label": `Add element to ${label}`, title: `Add element to ${label}`, onClick: add, style: { width: 28, height: 28, padding: 0, borderRadius: '50%', fontSize: 18, lineHeight: 1 }, children: "\uFF0B" }) }), children] });
}
function ElementPicker({ types, close, choose }) {
    const [query, setQuery] = useState('');
    const [browseAll, setBrowseAll] = useState(false);
    const designed = types.map((type) => ({ kind: 'block', value: String(type.id), label: type.name, description: type.description ?? 'Reusable Designed Block.', category: 'designed', keywords: [type.name.toLowerCase(), 'designed', 'block'] }));
    const available = [...coreEditorElements, ...designed];
    const matches = searchEditorElements(available, query);
    const shown = browseAll || query ? matches : matches.filter((item) => item.frequentlyUsed || item.kind === 'block').slice(0, 6);
    const option = (item) => _jsxs("button", { type: "button", onClick: () => choose(toLibraryItem(item)), style: { minHeight: 74, padding: '10px 12px', textAlign: 'left', borderRadius: 6 }, children: [_jsx("strong", { style: { display: 'block' }, children: item.label }), _jsx("span", { style: { display: 'block', marginTop: 4, color: 'var(--theme-elevation-600)', fontSize: 12 }, children: item.description })] }, `${item.kind}:${item.value}`);
    return _jsx("div", { role: "presentation", onMouseDown: (event) => { if (event.currentTarget === event.target)
            close(); }, style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.32)' }, children: _jsxs("section", { role: "dialog", "aria-modal": "true", "aria-labelledby": "element-picker-title", style: { ...panel, width: 'min(680px, 100%)', maxHeight: 'min(720px, 85vh)', overflowY: 'auto', background: 'var(--theme-elevation-0)', boxShadow: '0 18px 60px rgba(0,0,0,.24)' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }, children: [_jsxs("div", { children: [_jsx("h2", { id: "element-picker-title", style: { marginBottom: 4 }, children: "Add an element" }), _jsx("p", { style: { marginTop: 0 }, children: "Choose what to place in this area." })] }), _jsx("button", { type: "button", "aria-label": "Close element picker", onClick: close, style: { width: 32, height: 32, padding: 0 }, children: "\u00D7" })] }), _jsx("input", { autoFocus: true, "aria-label": "Search elements", type: "search", placeholder: "Search blocks", value: query, onChange: (event) => setQuery(event.target.value), style: { width: '100%', marginBottom: 16 } }), !browseAll && !query && _jsx("h3", { children: "Most used" }), browseAll && [...new Set(shown.map((item) => item.category))].map((category) => _jsxs("section", { children: [_jsx("h3", { children: editorCategoryLabels[category] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }, children: shown.filter((item) => item.category === category).map(option) })] }, category)), !browseAll && _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }, children: shown.map(option) }), !browseAll && !query && _jsx("button", { type: "button", onClick: () => setBrowseAll(true), style: { width: '100%', marginTop: 16, padding: 10 }, children: "Browse all blocks" }), !shown.length && _jsxs("p", { children: ["No blocks match \u201C", query, "\u201D."] })] }) });
}
function ListTree({ nodes, actions, selectedID, depth = 0 }) {
    return _jsx("div", { role: depth ? 'group' : 'tree', "aria-label": depth ? undefined : 'Template block list', children: nodes.map((node) => {
            const label = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout === 'columns' ? `Columns ${node.columns?.map((column) => column.width).join('/')}` : node.layout;
            return _jsxs("div", { role: "treeitem", "aria-level": depth + 1, "aria-selected": selectedID === node.id, style: { marginLeft: depth * 12 }, children: [_jsxs("button", { type: "button", onClick: () => actions.edit(node), style: { width: '100%', padding: '7px 8px', textAlign: 'left', border: 0, borderBottom: '1px solid var(--theme-elevation-100)', background: selectedID === node.id ? 'var(--theme-elevation-100)' : 'transparent' }, children: [node.type === 'layout' ? '▦' : node.type === 'block' ? '◆' : '¶', " ", label] }), node.type === 'layout' && _jsxs(_Fragment, { children: [node.children?.length ? _jsx(ListTree, { nodes: node.children, actions: actions, selectedID: selectedID, depth: depth + 1 }) : null, node.columns?.map((column, index) => _jsxs("div", { style: { marginLeft: (depth + 1) * 12 }, children: [_jsxs("div", { style: { padding: '5px 8px', color: 'var(--theme-elevation-600)', fontSize: 12 }, children: ["Column ", index + 1] }), _jsx(ListTree, { nodes: column.children, actions: actions, selectedID: selectedID, depth: depth + 2 })] }, column.id))] })] }, node.id);
        }) });
}
function Tree({ nodes, actions }) { return _jsx("div", { style: { display: 'grid', gap: 8 }, children: nodes.map((node) => _jsx(CanvasNode, { node: node, siblings: nodes, actions: actions }, node.id)) }); }
function CanvasNode({ node, siblings, actions }) {
    const drag = useDraggable({ id: `node:${node.id}`, data: { nodeID: node.id } });
    const index = siblings.findIndex((item) => item.id === node.id);
    const title = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout;
    const controls = _jsxs("div", { style: { display: 'flex', gap: 4, flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", ...drag.listeners, ...drag.attributes, "aria-label": `Drag ${title}`, children: "\u283F" }), _jsx("button", { type: "button", onClick: () => actions.edit(node), children: "Edit" }), _jsx("button", { type: "button", disabled: index <= 0, onClick: () => actions.move(node.id, -1), children: "Move Up" }), _jsx("button", { type: "button", disabled: index === siblings.length - 1, onClick: () => actions.move(node.id, 1), children: "Move Down" }), _jsx("button", { type: "button", onClick: () => actions.remove(node.id), children: "Remove" })] });
    if (node.type === 'field')
        return _jsxs("article", { ref: drag.setNodeRef, style: panel, children: [_jsx("strong", { children: node.label }), _jsxs("p", { children: [fieldItems.find((item) => item.value === node.fieldType)?.label, node.required ? ' · Required' : ''] }), controls] });
    if (node.type === 'block')
        return _jsxs("article", { ref: drag.setNodeRef, style: panel, children: [_jsx("strong", { children: node.name }), _jsxs("p", { children: ["Designed Block \u00B7 ", node.fields.length, " mapped field", node.fields.length === 1 ? '' : 's'] }), controls] });
    return _jsxs("article", { ref: drag.setNodeRef, style: panel, children: [_jsx("strong", { children: node.layout === 'columns' ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}` : title }), controls, node.layout === 'columns' ? _jsx("div", { style: { display: 'grid', gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' '), gap: 8, marginTop: 8 }, children: node.columns?.map((column, i) => _jsx(DropArea, { id: column.id, label: `Column ${i + 1}`, add: () => actions.add(column.id), addItem: (item) => actions.addItem(item, column.id), children: _jsx(Tree, { nodes: column.children, actions: actions }) }, column.id)) }) : !['spacer', 'divider'].includes(node.layout) ? _jsx("div", { style: { marginTop: 8 }, children: _jsx(DropArea, { id: node.id, label: `${node.layout} contents`, add: () => actions.add(node.id), addItem: (item) => actions.addItem(item, node.id), children: _jsx(Tree, { nodes: node.children ?? [], actions: actions }) }) }) : null] });
}
export function TemplateBuilder({ configuredCollections = ['posts'], registeredRendererKeys = ['hero-board'] }) {
    const { id, hasPublishedDoc } = useDocumentInfo();
    const { submit, disabled } = useForm();
    const nameField = useField({ path: 'name' });
    const descriptionField = useField({ path: 'description' });
    const slugField = useField({ path: 'slug' });
    const collectionsField = useField({ path: 'allowedCollections' });
    const layoutField = useField({ path: 'layout' });
    const sectionsField = useField({ path: 'sections' });
    const statusField = useField({ path: '_status' });
    const name = nameField.value ?? '';
    const collections = Array.isArray(collectionsField.value) ? collectionsField.value : [];
    const nodes = Array.isArray(layoutField.value) ? layoutField.value : [];
    const legacy = Array.isArray(sectionsField.value) ? sectionsField.value : [];
    const [types, setTypes] = useState([]);
    const [designs, setDesigns] = useState([]);
    const [impact, setImpact] = useState([]);
    const [editing, setEditing] = useState(null);
    const [adding, setAdding] = useState(null);
    const [target, setTarget] = useState('root');
    const [libraryTarget, setLibraryTarget] = useState('root');
    const [libraryOpen, setLibraryOpen] = useState(true);
    const [libraryMode, setLibraryMode] = useState('blocks');
    const [pickerTarget, setPickerTarget] = useState(null);
    const [error, setError] = useState(null);
    const modified = useRef(false);
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    useEffect(() => {
        Promise.all([
            fetchDocs('/api/design-block-types?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published'),
            fetchDocs('/api/design-block-designs?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published'),
        ]).then(([typeDocs, designDocs]) => { setTypes(typeDocs.filter((item) => item.rendererKey && registeredRendererKeys.includes(item.rendererKey))); setDesigns(designDocs); }).catch(() => setError('Could not load the registered design library.'));
    }, [registeredRendererKeys]);
    useEffect(() => {
        if (!id)
            return;
        async function load() {
            try {
                const response = await fetch(`/api/design-templates/${id}?draft=true&depth=0`, { credentials: 'same-origin' });
                const doc = response.ok ? await response.json() : null;
                if (!modified.current) {
                    if (Array.isArray(doc?.layout))
                        layoutField.setValue(doc.layout);
                    if (Array.isArray(doc?.sections))
                        sectionsField.setValue(doc.sections);
                }
            }
            catch { /* keep current form data */ }
            try {
                const response = await fetch(`/api/design-templates/${id}/dependencies`, { credentials: 'same-origin' });
                const body = response.ok ? await response.json() : [];
                setImpact(Array.isArray(body) ? body : []);
            }
            catch {
                setImpact([]);
            }
        }
        void load();
    }, [id, layoutField, sectionsField]);
    const setNodes = (next) => { modified.current = true; layoutField.setValue(next); };
    const startAdd = (item, container = 'root') => { setAdding(item); setTarget(container); setEditing(null); };
    const openPickerFor = (containerID) => setPickerTarget(containerID);
    const actions = { edit: (node) => { setEditing(node); setAdding(null); }, add: openPickerFor, addItem: (item, containerID) => startAdd(item, containerID), move: (nodeID, direction) => setNodes(moveTemplateNode(nodes, nodeID, direction)), remove: (nodeID) => { if (!hasPublishedDoc || !impact.length || window.confirm(`This Template is used by ${impact.length} content items. Removed field values remain stored. Continue?`))
            setNodes(removeTemplateNode(nodes, nodeID)); } };
    function dragEnd(event) { const container = event.over?.data.current?.containerID; if (!container)
        return; const library = event.active.data.current?.library; if (library)
        startAdd(library, container);
    else {
        const nodeID = event.active.data.current?.nodeID;
        if (nodeID)
            setNodes(moveTemplateNodeTo(nodes, nodeID, container));
    } }
    async function save(publish) { if (!name.trim() || !collections.length) {
        setError('Name and Use With are required.');
        return;
    } await submit({ overrides: { slug: slugField.value || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), status: publish ? 'published' : 'draft', _status: publish ? 'published' : 'draft' } }); }
    return _jsx(DndContext, { id: "template-builder-dnd", sensors: sensors, collisionDetection: pointerWithin, onDragEnd: dragEnd, children: _jsxs("div", { "data-testid": "template-builder", style: { display: 'grid', gap: 16 }, children: [_jsxs("header", { children: [_jsx("h1", { children: name || 'Create Template' }), _jsx("strong", { children: statusField.value === 'published' ? 'Published' : 'Draft' }), id && _jsxs("p", { children: ["Used by: ", impact.length, " content item", impact.length === 1 ? '' : 's'] })] }), _jsxs("section", { style: panel, children: [_jsxs("label", { children: ["Name", _jsx("input", { "aria-label": "Name", value: name, onChange: (e) => nameField.setValue(e.target.value) })] }), _jsxs("label", { style: { display: 'grid', gap: 6, marginTop: 12 }, children: ["Description", _jsx("textarea", { "aria-label": "Description", value: descriptionField.value ?? '', onChange: (e) => descriptionField.setValue(e.target.value), style: { display: 'block', width: '100%', minHeight: 88, resize: 'vertical' } })] }), _jsxs("fieldset", { style: { marginTop: 12 }, children: [_jsx("legend", { children: "Use With" }), configuredCollections.map((slug) => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: collections.includes(slug), onChange: () => collectionsField.setValue(collections.includes(slug) ? collections.filter((item) => item !== slug) : [...collections, slug]) }), " ", slug[0].toUpperCase() + slug.slice(1)] }, slug))] })] }), _jsx("div", { children: _jsxs("button", { type: "button", "aria-expanded": libraryOpen, "aria-controls": "template-element-library", onClick: () => { setLibraryTarget('root'); setLibraryOpen((open) => !open); }, children: ["\u2630 ", libraryOpen ? 'Close' : 'Open', " Element Library"] }) }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: libraryOpen ? '240px minmax(0, 1fr) minmax(280px, 360px)' : 'minmax(0, 1fr) minmax(280px, 360px)', gap: 16, alignItems: 'start' }, children: [libraryOpen && _jsxs("aside", { id: "template-element-library", style: { ...panel, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }, "aria-label": "Element Library", children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [_jsx("h2", { children: libraryMode === 'blocks' ? 'Block Library' : 'List View' }), _jsx("button", { type: "button", "aria-label": "Close Element Library", onClick: () => setLibraryOpen(false), children: "\u00D7" })] }), _jsxs("div", { role: "tablist", "aria-label": "Editor sidebar", style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 12 }, children: [_jsx("button", { role: "tab", "aria-selected": libraryMode === 'blocks', type: "button", onClick: () => setLibraryMode('blocks'), children: "Blocks" }), _jsx("button", { role: "tab", "aria-selected": libraryMode === 'list', type: "button", onClick: () => setLibraryMode('list'), children: "List View" })] }), libraryMode === 'list' ? _jsx(ListTree, { nodes: nodes, actions: actions, selectedID: editing?.id }) : _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Add to: ", _jsx("strong", { children: libraryTarget === 'root' ? 'Template Canvas' : 'selected container' })] }), _jsx("h3", { children: "Layout" }), layoutItems.map((item) => _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, item.value)), _jsx("h3", { children: "Fields" }), fieldItems.map((item) => _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, item.value)), _jsx("h3", { children: "Designed Blocks" }), types.map((type) => { const item = { kind: 'block', value: String(type.id), label: type.name }; return _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, type.id); })] })] }), _jsxs("main", { "aria-label": "Template Canvas", children: [_jsx("h2", { children: "Template Canvas" }), _jsxs(DropArea, { id: "root", label: "Template Canvas drop area", add: () => openPickerFor('root'), addItem: (item) => startAdd(item, 'root'), children: [!nodes.length && !legacy.length && _jsx("p", { style: { textAlign: 'center', color: 'var(--theme-elevation-600)' }, children: "Add the first element to this Template." }), _jsx(Tree, { nodes: nodes, actions: actions }), legacy.length > 0 && _jsxs("section", { children: [_jsx("h3", { children: "Existing Designed Blocks" }), legacy.map((section) => _jsxs("article", { style: panel, children: [_jsx("strong", { children: section.name }), _jsx("p", { children: "Legacy live reference retained. Rebuild on the canvas when ready." })] }, section.key))] })] })] }), _jsxs("aside", { "aria-label": "Configure panel", style: { ...panel, position: 'sticky', top: 16 }, children: [_jsx("h2", { children: "Configure" }), (adding || editing) ? _jsx(NodeEditor, { item: adding, node: editing, types: types, designs: designs, cancel: () => { setAdding(null); setEditing(null); }, create: (node) => { setNodes(insertTemplateNode(nodes, target, node)); setAdding(null); setLibraryTarget('root'); }, update: (node) => { setNodes(updateTemplateNode(nodes, node.id, () => node)); setEditing(null); } }) : _jsx("p", { children: "Select Edit on an element, drag an item from the library, or use an Add element button." })] })] }), pickerTarget && _jsx(ElementPicker, { types: types, close: () => setPickerTarget(null), choose: (item) => { startAdd(item, pickerTarget); setPickerTarget(null); } }), error && _jsx("p", { role: "alert", children: error }), _jsxs("footer", { children: [_jsx("button", { type: "button", disabled: disabled, onClick: () => void save(false), children: "Save Draft" }), " ", _jsx("button", { type: "button", disabled: disabled, onClick: () => void save(true), children: hasPublishedDoc ? 'Publish Changes' : 'Publish Template' })] })] }) });
}
function NodeEditor({ item, node, types, designs, cancel, create, update }) {
    const kind = item?.kind ?? node?.type;
    const value = item?.value ?? (node?.type === 'field' ? node.fieldType : node?.type === 'layout' ? node.layout : node?.type === 'block' ? String(relationID(node.blockType)) : '');
    const [label, setLabel] = useState(node?.type === 'field' ? node.label : item?.label ?? '');
    const [required, setRequired] = useState(node?.type === 'field' && !!node.required);
    const [help, setHelp] = useState(node?.type === 'field' ? node.helpText ?? '' : '');
    const [placeholder, setPlaceholder] = useState(node?.type === 'field' ? node.placeholder ?? '' : '');
    const [ratio, setRatio] = useState(node?.type === 'layout' && node.layout === 'columns' ? node.columns?.map((column) => column.width).join('/') ?? '50/50' : '50/50');
    const type = types.find((option) => String(option.id) === value);
    const block = node?.type === 'block' ? node : null;
    const [design, setDesign] = useState(relationID(block?.blockDesign) ?? '');
    const [allowOverride, setAllowOverride] = useState(!!block?.allowDesignOverride);
    const [fields, setFields] = useState(block?.fields ?? []);
    const [mappings, setMappings] = useState(block?.slotMappings ?? {});
    function finish() { let next; if (kind === 'layout') {
        const layout = value;
        next = { id: node?.id ?? uid('layout'), type: 'layout', layout, ...(layout === 'columns' ? { columns: ratio.split('/').map((width) => ({ id: uid('column'), width: Number(width), children: [] })) } : ['spacer', 'divider'].includes(layout) ? {} : { children: node?.type === 'layout' ? node.children ?? [] : [] }) };
    }
    else if (kind === 'field')
        next = { id: node?.id ?? uid('field'), type: 'field', fieldType: value, label: label || item?.label || 'Untitled', required, helpText: help, placeholder };
    else {
        if (!type || !design)
            return;
        next = { id: node?.id ?? uid('block'), type: 'block', name: type.name, blockType: type.id, blockDesign: design, allowDesignOverride: allowOverride, fields, slotMappings: mappings };
    } if (node)
        update(next);
    else
        create(next); }
    function mapSlot(slot) { const old = mappings[slot.key]; if (old) {
        setMappings(Object.fromEntries(Object.entries(mappings).filter(([key]) => key !== slot.key)));
        setFields(fields.filter((field) => field.id !== old));
        return;
    } const field = { id: uid('field'), type: 'field', fieldType: slot.kind === 'media' ? 'image' : slot.kind === 'textarea' ? 'longText' : slot.kind === 'boolean' ? 'toggle' : 'shortText', label: slot.label, required: !!slot.required }; setFields([...fields, field]); setMappings({ ...mappings, [slot.key]: field.id }); }
    const control = { display: 'grid', gap: 6 };
    return _jsxs("section", { "aria-label": "Configure element", children: [_jsxs("h2", { style: { marginTop: 0 }, children: ["Configure ", item?.label ?? (node?.type === 'field' ? node.label : node?.type === 'block' ? node.name : node?.layout)] }), kind === 'field' && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Field label" }), _jsx("input", { "aria-label": "Field Label", value: label, onChange: (e) => setLabel(e.target.value), style: { width: '100%' } })] }), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: required, onChange: (e) => setRequired(e.target.checked) }), " Required"] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Help text" }), _jsx("textarea", { "aria-label": "Help Text", value: help, onChange: (e) => setHelp(e.target.value), rows: 3, style: { width: '100%', resize: 'vertical' } })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Placeholder" }), _jsx("input", { "aria-label": "Placeholder", value: placeholder, onChange: (e) => setPlaceholder(e.target.value), style: { width: '100%' } })] }), _jsx("p", { style: { margin: 0, color: 'var(--theme-elevation-600)', fontSize: 12 }, children: "This element keeps the same stable identity when it is renamed or moved." })] }), kind === 'layout' && value === 'columns' && _jsxs("label", { style: control, children: [_jsx("span", { children: "Column layout" }), _jsx("select", { "aria-label": "Column Layout", value: ratio, onChange: (e) => setRatio(e.target.value), style: { width: '100%' }, children: ['100', '50/50', '60/40', '40/60', '70/30', '30/70', '33/33/34', '50/25/25', '25/50/25', '25/25/50', '25/25/25/25'].map((option) => _jsx("option", { children: option }, option)) })] }), kind === 'block' && type && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("p", { children: ["Component: ", _jsx("strong", { children: type.name })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Design" }), _jsxs("select", { "aria-label": "Design", value: String(design), onChange: (e) => setDesign(designs.find((option) => String(option.id) === e.target.value)?.id ?? ''), style: { width: '100%' }, children: [_jsx("option", { value: "", children: "Choose Design" }), designs.filter((option) => String(relationID(option.blockType)) === String(type.id)).map((option) => _jsx("option", { value: String(option.id), children: option.name }, option.id))] })] }), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: allowOverride, onChange: (e) => setAllowOverride(e.target.checked) }), " Allow editor to change Design"] }), _jsx("h3", { children: "Content mapping" }), (type.fields ?? []).map((slot) => { const mapped = fields.find((field) => field.id === mappings[slot.key]); return _jsxs("section", { style: { ...panel, padding: 10 }, children: [_jsx("strong", { children: slot.label }), " ", _jsx("button", { type: "button", onClick: () => mapSlot(slot), children: mapped ? 'Remove mapped field' : 'Add / Map Field' }), mapped && _jsxs("div", { style: { display: 'grid', gap: 10, marginTop: 10 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Field label" }), _jsx("input", { "aria-label": `${slot.label} Field Label`, value: mapped.label, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id ? { ...field, label: event.target.value } : field)) })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!mapped.required, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id ? { ...field, required: event.target.checked } : field)) }), " Required"] })] })] }, slot.key); })] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 18 }, children: [_jsx("button", { type: "button", onClick: finish, children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] })] });
}
