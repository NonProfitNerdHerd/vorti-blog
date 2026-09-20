'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and reactive drag state as hook return values. */
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui';
import { useEffect, useRef, useState } from 'react';
import { coreEditorElements, editorCategoryLabels, searchEditorElements, toLibraryItem } from '../editor-registry.js';
import { insertTemplateNode, moveTemplateNode, moveTemplateNodeTo, removeTemplateNode, updateTemplateNode } from '../template-tree.js';
import './template-builder.css';
let pendingLibraryPointerItem = null;
const layoutItems = coreEditorElements.filter((item) => item.kind === 'layout').map(toLibraryItem);
const fieldItems = coreEditorElements.filter((item) => item.kind === 'field').map(toLibraryItem);
const panel = { border: '1px solid var(--theme-elevation-150)', borderRadius: 8, padding: '1rem' };
const relationID = (value) => typeof value === 'string' || typeof value === 'number' ? value : value && typeof value === 'object' && 'id' in value ? value.id : undefined;
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const columnRatios = ['100', '50/50', '60/40', '40/60', '70/30', '30/70', '33/33/34', '50/25/25', '25/50/25', '25/25/50', '25/25/25/25'];
async function fetchDocs(url) { const response = await fetch(url, { credentials: 'same-origin' }); if (!response.ok)
    return []; const body = await response.json(); return body.docs ?? []; }
function LibraryButton({ item, add }) {
    return _jsxs("div", { className: "template-editor__library-item", children: [_jsx("button", { type: "button", className: "template-editor__library-icon", draggable: true, "aria-label": `Drag ${item.label}`, onPointerDown: () => { pendingLibraryPointerItem = item; }, onPointerCancel: () => { pendingLibraryPointerItem = null; }, onDragStart: (event) => { const serialized = JSON.stringify(item); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-template-library', serialized); event.dataTransfer.setData('text/plain', serialized); }, children: item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶' }), _jsx("button", { type: "button", className: "template-editor__library-action", onClick: add, children: item.label })] });
}
function DropArea({ id, label, children, add, addItem }) {
    const drop = useDroppable({ id: `container:${id}`, data: { containerID: id } });
    return _jsx("div", { className: "template-editor__drop-area", children: _jsxs("div", { ref: drop.setNodeRef, className: "template-editor__drop-target", "data-over": drop.isOver, "aria-label": label, onPointerUp: (event) => { event.stopPropagation(); if (pendingLibraryPointerItem && addItem)
                addItem(pendingLibraryPointerItem); pendingLibraryPointerItem = null; }, onDragOver: (event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; }, onDrop: (event) => { event.preventDefault(); event.stopPropagation(); const value = event.dataTransfer.getData('application/x-template-library') || event.dataTransfer.getData('text/plain'); if (!value || !addItem)
                return; pendingLibraryPointerItem = null; try {
                addItem(JSON.parse(value));
            }
            catch { /* ignore invalid external drag data */ } }, children: [_jsx("div", { className: "template-editor__inserter-row", children: add && _jsx("button", { type: "button", className: "template-editor__inserter", "aria-label": `Add element to ${label}`, title: `Add element to ${label}`, onClick: add, children: "+" }) }), children] }) });
}
function ElementPicker({ types, close, choose }) {
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const designed = types.map((type) => ({ kind: 'block', value: String(type.id), label: type.name, description: type.description ?? 'Reusable Designed Block.', category: 'designed', keywords: [type.name.toLowerCase(), 'designed', 'block'] }));
    const available = [...coreEditorElements, ...designed];
    const matches = searchEditorElements(available, query).filter((item) => category === 'all' || item.category === category);
    const categories = ['all', 'text', 'media', 'layout', 'data', 'designed'];
    const option = (item) => _jsxs("button", { type: "button", className: "template-editor__picker-card", onClick: () => choose(toLibraryItem(item)), children: [_jsx("span", { className: "template-editor__picker-card-icon", "aria-hidden": "true", children: item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶' }), _jsxs("span", { children: [_jsx("strong", { children: item.label }), _jsx("small", { children: item.description })] })] }, `${item.kind}:${item.value}`);
    return _jsx("div", { role: "presentation", className: "template-editor__picker-backdrop", onMouseDown: (event) => { if (event.currentTarget === event.target)
            close(); }, children: _jsxs("section", { role: "dialog", "aria-modal": "true", "aria-labelledby": "element-picker-title", className: "template-editor__picker", children: [_jsxs("header", { className: "template-editor__picker-header", children: [_jsxs("div", { children: [_jsx("h2", { id: "element-picker-title", children: "Add an element" }), _jsx("p", { children: "Choose what to place in this area." })] }), _jsx("button", { type: "button", className: "template-editor__picker-close", "aria-label": "Close element picker", onClick: close, children: "\u00D7" })] }), _jsxs("label", { className: "template-editor__picker-search", children: [_jsx("span", { "aria-hidden": "true", children: "\u2315" }), _jsx("input", { autoFocus: true, "aria-label": "Search elements", type: "search", placeholder: "Search blocks and elements", value: query, onChange: (event) => setQuery(event.target.value) })] }), _jsx("div", { role: "tablist", "aria-label": "Block categories", className: "template-editor__picker-tabs", children: categories.map((item) => _jsx("button", { type: "button", role: "tab", "aria-selected": category === item, onClick: () => setCategory(item), children: item === 'all' ? 'All' : editorCategoryLabels[item] }, item)) }), _jsxs("div", { className: "template-editor__picker-results", children: [category === 'all' && !query ? [...new Set(matches.map((item) => item.category))].map((group) => _jsxs("section", { className: "template-editor__picker-section", children: [_jsx("h3", { children: editorCategoryLabels[group] }), _jsx("div", { className: "template-editor__picker-grid", children: matches.filter((item) => item.category === group).map(option) })] }, group)) : _jsx("div", { className: "template-editor__picker-grid", children: matches.map(option) }), !matches.length && _jsxs("div", { className: "template-editor__picker-empty", children: [_jsx("strong", { children: "No matching blocks" }), _jsx("span", { children: "Try another search or category." })] })] })] }) });
}
function ListTree({ nodes, actions, selectedID, depth = 0 }) {
    return _jsx("div", { role: depth ? 'group' : 'tree', "aria-label": depth ? undefined : 'Template block list', children: nodes.map((node) => {
            const label = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout === 'columns' ? `Columns ${node.columns?.map((column) => column.width).join('/')}` : node.layout;
            return _jsxs("div", { role: "treeitem", "aria-level": depth + 1, "aria-selected": selectedID === node.id, style: { marginLeft: depth * 12 }, children: [_jsxs("button", { type: "button", className: "template-editor__list-row", "data-selected": selectedID === node.id, onClick: () => actions.edit(node), children: [_jsx("span", { className: "template-editor__list-icon", "aria-hidden": "true", children: node.type === 'layout' ? '▦' : node.type === 'block' ? '◆' : '¶' }), _jsx("span", { children: label })] }), node.type === 'layout' && _jsxs(_Fragment, { children: [node.children?.length ? _jsx(ListTree, { nodes: node.children, actions: actions, selectedID: selectedID, depth: depth + 1 }) : null, node.columns?.map((column, index) => _jsxs("div", { style: { marginLeft: (depth + 1) * 12 }, children: [_jsxs("div", { className: "template-editor__column-label", children: ["Column ", index + 1, " \u00B7 ", column.width, "%"] }), _jsx(ListTree, { nodes: column.children, actions: actions, selectedID: selectedID, depth: depth + 2 })] }, column.id))] })] }, node.id);
        }) });
}
function Tree({ nodes, actions, selectedID }) { return _jsx("div", { className: "template-editor__tree", children: nodes.map((node) => _jsx(CanvasNode, { node: node, siblings: nodes, actions: actions, selectedID: selectedID }, node.id)) }); }
function CanvasNode({ node, siblings, actions, selectedID }) {
    const drag = useDraggable({ id: `node:${node.id}`, data: { nodeID: node.id } });
    const index = siblings.findIndex((item) => item.id === node.id);
    const title = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout;
    const controls = _jsxs("div", { className: "template-editor__toolbar", children: [_jsx("button", { type: "button", className: "template-editor__tool-button", ...drag.listeners, ...drag.attributes, "aria-label": `Drag ${title}`, title: "Drag", children: "\u283F" }), _jsx("button", { type: "button", className: "template-editor__tool-button", "aria-label": `Edit ${title}`, title: "Settings", onClick: () => actions.edit(node), children: "\u2699" }), _jsx("button", { type: "button", className: "template-editor__tool-button", "aria-label": `Move ${title} up`, title: "Move up", disabled: index <= 0, onClick: () => actions.move(node.id, -1), children: "\u2191" }), _jsx("button", { type: "button", className: "template-editor__tool-button", "aria-label": `Move ${title} down`, title: "Move down", disabled: index === siblings.length - 1, onClick: () => actions.move(node.id, 1), children: "\u2193" }), _jsx("button", { type: "button", className: "template-editor__tool-button template-editor__tool-button--danger", "aria-label": `Remove ${title}`, title: "Remove", onClick: () => actions.remove(node.id), children: "\u00D7" })] });
    const fieldPreview = node.type === 'field' && (node.fieldType === 'shortText' ? _jsx("p", { className: "template-editor__node-preview template-editor__node-preview--heading", children: node.placeholder || node.label }) : ['longText', 'richText'].includes(node.fieldType) ? _jsx("p", { className: "template-editor__node-preview template-editor__node-preview--paragraph", children: node.placeholder || 'Add text for this area. Content editors will replace this preview.' }) : node.fieldType === 'image' ? _jsx("div", { className: "template-editor__node-preview--image" }) : node.fieldType === 'images' ? _jsxs("div", { className: "template-editor__node-preview--gallery", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }) : _jsxs("p", { className: "template-editor__node-preview", children: [fieldItems.find((item) => item.value === node.fieldType)?.label, node.required ? ' · Required' : ''] }));
    if (node.type === 'field')
        return _jsxs("article", { ref: drag.setNodeRef, className: "template-editor__node", "data-selected": selectedID === node.id, children: [controls, _jsxs("div", { className: "template-editor__node-body", role: "button", tabIndex: 0, onClick: () => actions.edit(node), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ')
                        actions.edit(node); }, children: [_jsx("strong", { className: "template-editor__node-title", children: node.label }), fieldPreview] })] });
    if (node.type === 'block')
        return _jsxs("article", { ref: drag.setNodeRef, className: "template-editor__node", "data-selected": selectedID === node.id, children: [controls, _jsxs("div", { className: "template-editor__node-body", role: "button", tabIndex: 0, onClick: () => actions.edit(node), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ')
                        actions.edit(node); }, children: [_jsx("strong", { className: "template-editor__node-title", children: node.name }), _jsxs("p", { className: "template-editor__node-preview", children: ["Designed Block \u00B7 ", node.fields.length, " mapped field", node.fields.length === 1 ? '' : 's'] })] })] });
    return _jsxs("article", { ref: drag.setNodeRef, className: "template-editor__node", "data-selected": selectedID === node.id, children: [controls, _jsx("div", { className: "template-editor__node-body", role: "button", tabIndex: 0, onClick: () => actions.edit(node), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ')
                    actions.edit(node); }, children: _jsx("strong", { className: "template-editor__node-title", children: node.layout === 'columns' ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}` : title }) }), node.layout === 'columns' ? _jsx("div", { className: "template-editor__columns", style: { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') }, children: node.columns?.map((column, i) => _jsx("div", { className: "template-editor__column", children: _jsx(DropArea, { id: column.id, label: `Column ${i + 1}`, add: () => actions.add(column.id), addItem: (item) => actions.addItem(item, column.id), children: _jsx(Tree, { nodes: column.children, actions: actions, selectedID: selectedID }) }) }, column.id)) }) : !['spacer', 'divider'].includes(node.layout) ? _jsx(DropArea, { id: node.id, label: `${node.layout} contents`, add: () => actions.add(node.id), addItem: (item) => actions.addItem(item, node.id), children: _jsx(Tree, { nodes: node.children ?? [], actions: actions, selectedID: selectedID }) }) : null] });
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
    return _jsx(DndContext, { id: "template-builder-dnd", sensors: sensors, collisionDetection: pointerWithin, onDragEnd: dragEnd, children: _jsxs("div", { "data-testid": "template-builder", className: "template-editor", children: [_jsxs("header", { className: "template-editor__header", children: [_jsxs("div", { children: [_jsx("h1", { children: name || 'Create Template' }), id && _jsxs("p", { children: ["Used by ", impact.length, " content item", impact.length === 1 ? '' : 's'] })] }), _jsx("strong", { className: "template-editor__status", children: statusField.value === 'published' ? 'Published' : 'Draft' })] }), _jsxs("section", { className: "template-editor__document", children: [_jsxs("label", { children: ["Name", _jsx("input", { "aria-label": "Name", value: name, onChange: (e) => nameField.setValue(e.target.value) })] }), _jsxs("label", { style: { display: 'grid', gap: 6, marginTop: 12 }, children: ["Description", _jsx("textarea", { "aria-label": "Description", value: descriptionField.value ?? '', onChange: (e) => descriptionField.setValue(e.target.value), style: { display: 'block', width: '100%', minHeight: 88, resize: 'vertical' } })] }), _jsxs("fieldset", { style: { marginTop: 12 }, children: [_jsx("legend", { children: "Use With" }), configuredCollections.map((slug) => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: collections.includes(slug), onChange: () => collectionsField.setValue(collections.includes(slug) ? collections.filter((item) => item !== slug) : [...collections, slug]) }), " ", slug[0].toUpperCase() + slug.slice(1)] }, slug))] })] }), _jsxs("button", { type: "button", className: "template-editor__toggle", "aria-expanded": libraryOpen, "aria-controls": "template-element-library", onClick: () => { setLibraryTarget('root'); setLibraryOpen((open) => !open); }, children: ["\u2630 ", libraryOpen ? 'Hide' : 'Show', " editor sidebar"] }), _jsxs("div", { className: "template-editor__workspace", "data-library": libraryOpen ? 'open' : 'closed', children: [libraryOpen && _jsx("aside", { id: "template-element-library", className: "template-editor__sidebar template-editor__sidebar--left", "aria-label": "Element Library", children: _jsxs("div", { className: "template-editor__sidebar-inner", children: [_jsxs("div", { className: "template-editor__sidebar-header", children: [_jsx("h2", { children: libraryMode === 'blocks' ? 'Blocks' : 'List View' }), _jsx("button", { type: "button", className: "template-editor__icon-button", "aria-label": "Close Element Library", onClick: () => setLibraryOpen(false), children: "\u00D7" })] }), _jsxs("div", { role: "tablist", "aria-label": "Editor sidebar", className: "template-editor__tabs", children: [_jsx("button", { role: "tab", "aria-selected": libraryMode === 'blocks', type: "button", onClick: () => setLibraryMode('blocks'), children: "Blocks" }), _jsx("button", { role: "tab", "aria-selected": libraryMode === 'list', type: "button", onClick: () => setLibraryMode('list'), children: "List View" })] }), libraryMode === 'list' ? _jsx(ListTree, { nodes: nodes, actions: actions, selectedID: editing?.id }) : _jsxs(_Fragment, { children: [_jsx("p", { className: "template-editor__section-label", children: "Layout" }), layoutItems.map((item) => _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, item.value)), _jsx("p", { className: "template-editor__section-label", children: "Fields" }), fieldItems.map((item) => _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, item.value)), _jsx("p", { className: "template-editor__section-label", children: "Designed Blocks" }), types.map((type) => { const item = { kind: 'block', value: String(type.id), label: type.name }; return _jsx(LibraryButton, { item: item, add: () => startAdd(item, libraryTarget) }, type.id); })] })] }) }), _jsxs("main", { "aria-label": "Template Canvas", className: "template-editor__canvas", children: [_jsx("div", { className: "template-editor__canvas-header", children: _jsx("h2", { children: "Template Canvas" }) }), _jsxs(DropArea, { id: "root", label: "Template Canvas drop area", add: () => openPickerFor('root'), addItem: (item) => startAdd(item, 'root'), children: [!nodes.length && !legacy.length && _jsx("div", { className: "template-editor__empty", children: _jsx("p", { children: "Add the first block to this template." }) }), _jsx(Tree, { nodes: nodes, actions: actions, selectedID: editing?.id }), legacy.length > 0 && _jsxs("section", { children: [_jsx("h3", { children: "Existing Designed Blocks" }), legacy.map((section) => _jsxs("article", { style: panel, children: [_jsx("strong", { children: section.name }), _jsx("p", { children: "Legacy live reference retained. Rebuild on the canvas when ready." })] }, section.key))] })] })] }), _jsx("aside", { "aria-label": "Configure panel", className: "template-editor__sidebar template-editor__sidebar--right", children: _jsxs("div", { className: "template-editor__sidebar-inner", children: [_jsx("div", { className: "template-editor__sidebar-header", children: _jsx("h2", { children: "Settings" }) }), (adding || editing) ? _jsx(NodeEditor, { item: adding, node: editing, types: types, designs: designs, cancel: () => { setAdding(null); setEditing(null); }, create: (node) => { setNodes(insertTemplateNode(nodes, target, node)); setAdding(null); setLibraryTarget('root'); }, update: (node) => { setNodes(updateTemplateNode(nodes, node.id, () => node)); setEditing(null); } }) : _jsx("p", { className: "template-editor__inspector-empty", children: "Select a block on the canvas or in List View to edit its settings and styles." })] }) })] }), pickerTarget && _jsx(ElementPicker, { types: types, close: () => setPickerTarget(null), choose: (item) => { startAdd(item, pickerTarget); setPickerTarget(null); } }), error && _jsx("p", { role: "alert", children: error }), _jsxs("footer", { className: "template-editor__footer", children: [_jsx("button", { type: "button", disabled: disabled, onClick: () => void save(false), children: "Save Draft" }), _jsx("button", { type: "button", disabled: disabled, onClick: () => void save(true), children: hasPublishedDoc ? 'Publish Changes' : 'Publish Template' })] })] }) });
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
    const [tab, setTab] = useState('settings');
    const [style, setStyle] = useState(node?.style ?? {});
    function finish() { let next; if (kind === 'layout') {
        const layout = value;
        const oldColumns = node?.type === 'layout' && node.layout === 'columns' ? node.columns ?? [] : [];
        next = { id: node?.id ?? uid('layout'), type: 'layout', layout, style, ...(layout === 'columns' ? { columns: ratio.split('/').map((width, index) => ({ id: oldColumns[index]?.id ?? uid('column'), width: Number(width), children: oldColumns[index]?.children ?? [] })) } : ['spacer', 'divider'].includes(layout) ? {} : { children: node?.type === 'layout' ? node.children ?? [] : [] }) };
    }
    else if (kind === 'field')
        next = { id: node?.id ?? uid('field'), type: 'field', fieldType: value, label: label || item?.label || 'Untitled', required, helpText: help, placeholder, style };
    else {
        if (!type || !design)
            return;
        next = { id: node?.id ?? uid('block'), type: 'block', name: type.name, blockType: type.id, blockDesign: design, allowDesignOverride: allowOverride, fields, slotMappings: mappings, style };
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
    const tabButton = (name, text) => _jsx("button", { type: "button", role: "tab", "aria-selected": tab === name, onClick: () => setTab(name), style: { padding: '9px 6px', border: 0, borderBottom: tab === name ? '2px solid var(--theme-success-500)' : '2px solid transparent', background: 'transparent' }, children: text });
    return _jsxs("section", { "aria-label": "Configure element", children: [_jsxs("h2", { style: { marginTop: 0 }, children: ["Configure ", item?.label ?? (node?.type === 'field' ? node.label : node?.type === 'block' ? node.name : node?.layout)] }), _jsxs("div", { role: "tablist", "aria-label": "Element settings", style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18, borderBottom: '1px solid var(--theme-elevation-150)' }, children: [tabButton('settings', kind === 'layout' ? 'Layout' : 'Settings'), tabButton('style', 'Style'), tabButton('advanced', 'Advanced')] }), tab === 'settings' && kind === 'field' && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Field label" }), _jsx("input", { "aria-label": "Field Label", value: label, onChange: (e) => setLabel(e.target.value), style: { width: '100%' } })] }), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: required, onChange: (e) => setRequired(e.target.checked) }), " Required"] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Help text" }), _jsx("textarea", { "aria-label": "Help Text", value: help, onChange: (e) => setHelp(e.target.value), rows: 3, style: { width: '100%', resize: 'vertical' } })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Placeholder" }), _jsx("input", { "aria-label": "Placeholder", value: placeholder, onChange: (e) => setPlaceholder(e.target.value), style: { width: '100%' } })] }), _jsx("p", { style: { margin: 0, color: 'var(--theme-elevation-600)', fontSize: 12 }, children: "This element keeps the same stable identity when it is renamed or moved." })] }), tab === 'settings' && kind === 'layout' && value === 'columns' && _jsxs("div", { children: [_jsx("h3", { style: { marginTop: 0 }, children: "Choose a variation" }), _jsx("div", { role: "radiogroup", "aria-label": "Column Layout", style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }, children: columnRatios.map((option) => _jsxs("button", { type: "button", role: "radio", "aria-checked": ratio === option, onClick: () => setRatio(option), style: { padding: 10, border: ratio === option ? '2px solid var(--theme-success-500)' : '1px solid var(--theme-elevation-250)', borderRadius: 6, background: ratio === option ? 'var(--theme-elevation-100)' : 'transparent' }, children: [_jsx("span", { "aria-hidden": "true", style: { display: 'grid', gridTemplateColumns: option.split('/').map((width) => `${width}fr`).join(' '), gap: 3, height: 30, marginBottom: 6 }, children: option.split('/').map((_, index) => _jsx("span", { style: { display: 'block', border: '1px solid currentColor', borderRadius: 2 } }, index)) }), option] }, option)) })] }), tab === 'settings' && kind === 'layout' && value !== 'columns' && _jsx("p", { children: "Use the Style tab to control this layout\u2019s presentation." }), tab === 'settings' && kind === 'block' && type && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("p", { children: ["Component: ", _jsx("strong", { children: type.name })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Design" }), _jsxs("select", { "aria-label": "Design", value: String(design), onChange: (e) => setDesign(designs.find((option) => String(option.id) === e.target.value)?.id ?? ''), style: { width: '100%' }, children: [_jsx("option", { value: "", children: "Choose Design" }), designs.filter((option) => String(relationID(option.blockType)) === String(type.id)).map((option) => _jsx("option", { value: String(option.id), children: option.name }, option.id))] })] }), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: allowOverride, onChange: (e) => setAllowOverride(e.target.checked) }), " Allow editor to change Design"] }), _jsx("h3", { children: "Content mapping" }), (type.fields ?? []).map((slot) => { const mapped = fields.find((field) => field.id === mappings[slot.key]); return _jsxs("section", { style: { ...panel, padding: 10 }, children: [_jsx("strong", { children: slot.label }), " ", _jsx("button", { type: "button", onClick: () => mapSlot(slot), children: mapped ? 'Remove mapped field' : 'Add / Map Field' }), mapped && _jsxs("div", { style: { display: 'grid', gap: 10, marginTop: 10 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Field label" }), _jsx("input", { "aria-label": `${slot.label} Field Label`, value: mapped.label, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id ? { ...field, label: event.target.value } : field)) })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!mapped.required, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id ? { ...field, required: event.target.checked } : field)) }), " Required"] })] })] }, slot.key); })] }), tab === 'style' && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsx(SelectSetting, { label: "Width", value: style.width ?? 'content', options: ['content', 'wide', 'full'], change: (width) => setStyle({ ...style, width: width }) }), _jsx(SelectSetting, { label: "Alignment", value: style.alignment ?? 'left', options: ['left', 'center', 'right'], change: (alignment) => setStyle({ ...style, alignment: alignment }) }), _jsx(SelectSetting, { label: "Spacing", value: style.spacing ?? 'medium', options: ['none', 'small', 'medium', 'large'], change: (spacing) => setStyle({ ...style, spacing: spacing }) }), _jsx(SelectSetting, { label: "Background", value: style.background ?? 'transparent', options: ['transparent', 'surface', 'muted', 'accent'], change: (background) => setStyle({ ...style, background: background }) }), kind === 'field' && _jsxs(_Fragment, { children: [_jsx(SelectSetting, { label: "Text color", value: style.textColor ?? 'default', options: ['default', 'muted', 'accent', 'inverse'], change: (textColor) => setStyle({ ...style, textColor: textColor }) }), _jsx(SelectSetting, { label: "Font size", value: style.fontSize ?? 'medium', options: ['small', 'medium', 'large', 'xlarge'], change: (fontSize) => setStyle({ ...style, fontSize: fontSize }) })] })] }), tab === 'advanced' && _jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "HTML anchor" }), _jsx("input", { "aria-label": "HTML Anchor", value: style.anchor ?? '', onChange: (event) => setStyle({ ...style, anchor: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }) })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Additional CSS class" }), _jsx("input", { "aria-label": "Additional CSS Class", value: style.cssClass ?? '', onChange: (event) => setStyle({ ...style, cssClass: event.target.value }) })] }), _jsxs("p", { style: { margin: 0, color: 'var(--theme-elevation-600)', fontSize: 12 }, children: ["Stable element ID: ", node?.id ?? 'created when saved'] })] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 18 }, children: [_jsx("button", { type: "button", onClick: finish, children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] })] });
}
function SelectSetting({ label, value, options, change }) {
    return _jsxs("label", { style: { display: 'grid', gap: 6 }, children: [_jsx("span", { children: label }), _jsx("select", { "aria-label": label, value: value, onChange: (event) => change(event.target.value), children: options.map((option) => _jsx("option", { value: option, children: option[0].toUpperCase() + option.slice(1) }, option)) })] });
}
