'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- Undo history mutations also trigger a React state revision. */
import { useDocumentInfo, useField, useForm, useNav } from '@payloadcms/ui';
import { useEffect, useRef, useState } from 'react';
import { BuilderCore } from '../builder/BuilderCore.js';
import { BuilderSidebar, SidebarControls, useBuilderSidebar } from '../builder/BuilderSidebar.js';
import { templateSidebarNodes, duplicateBuilderNode, locateSidebar } from '../builder/sidebar-model.js';
import { BuilderCanvasTree, } from '../builder/BuilderTree.js';
import { RegisteredBlockEditor, NewRegisteredBlock } from '../builder/RegisteredBlockEditor.js';
import { listBlockDefinitions, getBlockDefinition } from '../blocks/registry.js';
import { toTemplateBlock, templateBlockValue, adapterListings, adapterPreviewNodes, mergeTemplateBlock, } from '../blocks/adapters.js';
import { ContentBlock } from '../content/ContentRenderer.js';
import { createContentNode, walkContent } from '../content/model.js';
import { variationsFor, styleOnlyKinds } from '../blocks/variations.js';
import { VariationPicker } from '../builder/VariationPicker.js';
import { resolveStyle, templateStyle } from '../content/model.js';
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector.js';
import { InspectorGesture, markInspectorGesture } from '../builder/InspectorControls.js';
import { EditorHeaderPortal, EditorHistory, EditorName } from '../builder/EditorHeader.js';
import { BuilderWorkspace } from '../builder/BuilderWorkspace.js';
import { BuilderPreviewFrame } from '../builder/BuilderPreviewToolbar.js';
import { DropArea } from '../builder/DropArea.js';
import { coreEditorElements, editorCategoryLabels, toLibraryItem, } from '../editor-registry.js';
import { findTemplateNode, insertTemplateNode, moveTemplateNode, moveTemplateNodeTo, removeTemplateNode, updateTemplateNode, } from '../template-tree.js';
import './template-builder.css';
const fieldItems = coreEditorElements.filter((item) => item.kind === 'field').map(toLibraryItem);
const panel = {
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 8,
    padding: '1rem',
};
const relationID = (value) => typeof value === 'string' || typeof value === 'number'
    ? value
    : value && typeof value === 'object' && 'id' in value
        ? value.id
        : undefined;
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const columnRatios = [
    '100',
    '50/50',
    '60/40',
    '40/60',
    '70/30',
    '30/70',
    '33/33/34',
    '50/25/25',
    '25/50/25',
    '25/25/50',
    '25/25/25/25',
];
const defaultConfiguredCollections = ['posts'];
const defaultRegisteredRendererKeys = ['hero-board'];
async function fetchDocs(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok)
        return [];
    const body = (await response.json());
    return body.docs ?? [];
}
function describeTemplateNode(node, actions, viewport = 'desktop', previews = new Map()) {
    if (node.type === 'layout' && node.block) {
        const definition = getBlockDefinition(node.block.kind);
        return {
            title: node.block.label ?? definition?.label ?? node.block.kind,
            icon: definition?.icon,
            directChildren: true,
            body: definition?.container ? null : (_jsx(ContentBlock, { node: previews.get(node.id) ?? node.block, viewport: viewport })),
            wrap: definition?.container
                ? (children) => (_jsx(ContentBlock, { node: templateBlockValue(node), viewport: viewport, children: children }))
                : undefined,
            children: definition?.container
                ? [{ id: node.id, label: 'Block contents', children: node.children ?? [] }]
                : undefined,
        };
    }
    const title = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout;
    const previewText = node.type === 'field'
        ? node.content?.source === 'static'
            ? node.content.value
            : node.content?.source === 'document'
                ? node.content.preview || `Sample ${node.content.field}`
                : node.placeholder ||
                    (node.fieldType === 'shortText'
                        ? 'Click to add heading text'
                        : 'Add text for this area.')
        : '';
    const fieldPreview = node.type === 'field' &&
        (node.fieldType === 'shortText' ? (_jsxs("div", { className: "template-editor__inline-wrap", children: [node.content?.source === 'document' && (_jsxs("span", { className: "template-editor__binding-badge", children: ["\u2197 ", node.content.field] })), _jsx("p", { className: "template-editor__node-preview template-editor__node-preview--heading", contentEditable: node.content?.source !== 'document', suppressContentEditableWarning: true, onClick: (event) => event.stopPropagation(), onFocus: () => actions.edit(node), onBlur: (event) => actions.updateStatic(node, event.currentTarget.textContent ?? ''), children: previewText })] })) : ['longText', 'richText'].includes(node.fieldType) ? (_jsx("p", { className: "template-editor__node-preview template-editor__node-preview--paragraph", contentEditable: node.content?.source === 'static', suppressContentEditableWarning: true, onFocus: () => actions.edit(node), onBlur: (event) => {
                if (node.content?.source === 'static')
                    actions.updateStatic(node, event.currentTarget.textContent ?? '');
            }, children: previewText })) : node.fieldType === 'image' ? (_jsx("div", { className: "template-editor__node-preview--image" })) : node.fieldType === 'images' ? (_jsxs("div", { className: "template-editor__node-preview--gallery", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] })) : (_jsxs("p", { className: "template-editor__node-preview", children: [fieldItems.find((item) => item.value === node.fieldType)?.label, node.required ? ' · Required' : ''] })));
    if (node.type === 'field')
        return {
            title,
            listTitle: node.label,
            bodyAriaLabel: node.label,
            icon: '¶',
            body: fieldPreview,
        };
    if (node.type === 'block')
        return {
            title,
            icon: '◆',
            body: (_jsxs(_Fragment, { children: [_jsx("strong", { className: "template-editor__node-title", children: node.name }), _jsxs("p", { className: "template-editor__node-preview", children: ["Designed Block \u00B7 ", node.fields.length, " mapped field", node.fields.length === 1 ? '' : 's'] })] })),
        };
    const children = node.layout === 'columns'
        ? node.columns?.map((column, index) => ({
            id: column.id,
            label: `Column ${index + 1}`,
            listLabel: `Column ${index + 1} · ${column.width}%`,
            className: 'template-editor__column',
            children: column.children,
        }))
        : !['spacer', 'divider'].includes(node.layout)
            ? [{ id: node.id, label: `${node.layout} contents`, children: node.children ?? [] }]
            : undefined;
    const layoutTitle = node.layout === 'columns'
        ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}`
        : title;
    return {
        title: layoutTitle,
        listTitle: node.layout === 'columns'
            ? `Columns ${node.columns?.map((column) => column.width).join('/')}`
            : title,
        icon: '▦',
        body: _jsx("strong", { className: "template-editor__node-title", children: layoutTitle }),
        children,
        childrenClassName: node.layout === 'columns' ? 'template-editor__columns' : undefined,
        childrenStyle: node.layout === 'columns'
            ? { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') }
            : undefined,
    };
}
export function ContentTemplateBuilder({ configuredCollections = defaultConfiguredCollections, registeredRendererKeys = defaultRegisteredRendererKeys, }) {
    const { id, hasPublishedDoc } = useDocumentInfo();
    const { submit, disabled } = useForm();
    const nameField = useField({ path: 'name' });
    const descriptionField = useField({ path: 'description' });
    const slugField = useField({ path: 'slug' });
    const collectionsField = useField({ path: 'allowedCollections' });
    const layoutField = useField({ path: 'layout' });
    const customFieldsField = useField({ path: 'customFields' });
    const sectionsField = useField({ path: 'sections' });
    const name = nameField.value ?? '';
    const collections = Array.isArray(collectionsField.value) ? collectionsField.value : [];
    const nodes = Array.isArray(layoutField.value) ? layoutField.value : [];
    const previews = new Map(walkContent(adapterPreviewNodes(nodes)).map((node) => [node.id, node]));
    const customFields = Array.isArray(customFieldsField.value) ? customFieldsField.value : [];
    const legacy = Array.isArray(sectionsField.value) ? sectionsField.value : [];
    const [types, setTypes] = useState([]);
    const [designs, setDesigns] = useState([]);
    const [impact, setImpact] = useState([]);
    const [editing, setEditing] = useState(null);
    const [adding, setAdding] = useState(null);
    const [variationChooser, setVariationChooser] = useState('');
    const [target, setTarget] = useState('root');
    const [beforeTarget, setBeforeTarget] = useState();
    const sidebar = useBuilderSidebar(`template:${id ?? 'new'}`);
    const [sidebarSelected, setSidebarSelected] = useState();
    const [error, setError] = useState(null);
    const [viewport, setViewport] = useState('desktop');
    const nav = useNav();
    const collapsed = useRef(false);
    useEffect(() => {
        if (nav.hydrated && !collapsed.current) {
            collapsed.current = true;
            nav.setNavOpen(false);
        }
    }, [nav]);
    const history = useRef({ past: [], future: [] });
    const lastHistoryChange = useRef(0);
    const snapshot = () => structuredClone({ nodes, fields: customFields });
    const record = (typing = false) => {
        const now = Date.now();
        if (InspectorGesture.active
            ? !InspectorGesture.changed
            : InspectorGesture.pending || !typing || now - lastHistoryChange.current > 700)
            history.current.past.push(snapshot());
        markInspectorGesture();
        lastHistoryChange.current = typing ? now : 0;
        history.current.past = history.current.past.slice(-100);
        history.current.future = [];
    };
    const restore = (redo = false) => {
        lastHistoryChange.current = 0;
        const next = (redo ? history.current.future : history.current.past).pop();
        if (!next)
            return;
        (redo ? history.current.past : history.current.future).push(snapshot());
        layoutField.setValue(next.nodes);
        customFieldsField.setValue(next.fields);
        setEditing(null);
    };
    const modified = useRef(false);
    useEffect(() => {
        Promise.all([
            fetchDocs('/api/design-block-types?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published'),
            fetchDocs('/api/design-block-designs?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published'),
        ])
            .then(([typeDocs, designDocs]) => {
            setTypes(typeDocs.filter((item) => item.rendererKey && registeredRendererKeys.includes(item.rendererKey)));
            setDesigns(designDocs);
        })
            .catch(() => setError('Could not load the registered design library.'));
    }, [registeredRendererKeys]);
    useEffect(() => {
        if (!id)
            return;
        async function load() {
            try {
                const response = await fetch(`/api/design-templates/${id}?draft=true&depth=0`, {
                    credentials: 'same-origin',
                });
                const doc = response.ok
                    ? (await response.json())
                    : null;
                if (!modified.current) {
                    if (Array.isArray(doc?.layout))
                        layoutField.setValue(doc.layout);
                    if (Array.isArray(doc?.customFields))
                        customFieldsField.setValue(doc.customFields);
                    if (Array.isArray(doc?.sections))
                        sectionsField.setValue(doc.sections);
                }
            }
            catch {
                /* keep current form data */
            }
            try {
                const response = await fetch(`/api/design-templates/${id}/dependencies`, {
                    credentials: 'same-origin',
                });
                const body = response.ok ? (await response.json()) : [];
                setImpact(Array.isArray(body) ? body : []);
            }
            catch {
                setImpact([]);
            }
        }
        void load();
    }, [customFieldsField, id, layoutField, sectionsField]);
    const setNodes = (next, typing = false) => {
        if (disabled)
            return;
        record(typing);
        modified.current = true;
        layoutField.setValue(next);
        setEditing((current) => (current ? findTemplateNode(next, current.id) : null));
    };
    const startAdd = (item, container = 'root', before) => {
        if (disabled)
            return;
        if (item.kind === 'registered' &&
            variationsFor(item.value).length > 1 &&
            !styleOnlyKinds.has(item.value)) {
            const node = toTemplateBlock(createContentNode(item.value));
            setNodes(insertTemplateNode(nodes, container, node, before));
            setEditing(node);
            setSidebarSelected(node.id);
            setVariationChooser(node.id);
            setAdding(null);
            sidebar.inserted();
            return;
        }
        setBeforeTarget(before);
        setAdding(item);
        setTarget(container);
        setEditing(null);
    };
    const openPickerFor = (containerID, before) => sidebar.insert({ parent: containerID, before });
    const actions = {
        edit: (node) => {
            setSidebarSelected(node.id);
            setEditing(node);
            setAdding(null);
        },
        updateStatic: (node, value) => {
            const next = { ...node, placeholder: value, content: { source: 'static', value } };
            setNodes(updateTemplateNode(nodes, node.id, () => next));
            setEditing(next);
        },
        add: openPickerFor,
        addItem: (item, containerID) => startAdd(item, containerID),
        move: (nodeID, direction) => setNodes(moveTemplateNode(nodes, nodeID, direction)),
        remove: (nodeID) => {
            if (!hasPublishedDoc ||
                !impact.length ||
                window.confirm(`This Template is used by ${impact.length} content items. Removed field values remain stored. Continue?`)) {
                setNodes(removeTemplateNode(nodes, nodeID));
                setEditing(null);
                setSidebarSelected(undefined);
            }
        },
    };
    async function save(publish) {
        if (!name.trim() || !collections.length) {
            setError('Name and Use With are required.');
            return;
        }
        await submit({
            overrides: {
                slug: slugField.value ||
                    name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, ''),
                status: publish ? 'published' : 'draft',
                _status: publish ? 'published' : 'draft',
            },
        });
    }
    return (_jsx(BuilderCore, { id: "template-builder-dnd", onInsert: (item, containerID, before) => startAdd(item, containerID, before), onMove: (nodeID, containerID, before) => setNodes(moveTemplateNodeTo(nodes, nodeID, containerID, before)), children: _jsxs("div", { "data-testid": "template-builder", className: "template-editor", children: [_jsx(EditorName, {}), _jsx(EditorHistory, { undo: () => restore(), redo: () => restore(true), canUndo: !disabled && Boolean(history.current.past.length), canRedo: !disabled && Boolean(history.current.future.length) }), _jsx(_Fragment, { children: _jsx(BuilderWorkspace, { viewport: viewport, onViewportChange: setViewport, documentLabel: "Template", readOnly: disabled, documentSettings: _jsxs(_Fragment, { children: [_jsx("h3", { children: "Template Properties" }), id && (_jsxs("p", { children: ["Used by ", impact.length, " content item", impact.length === 1 ? '' : 's'] })), _jsxs("section", { className: "template-editor__document", children: [_jsxs("label", { style: { display: 'grid', gap: 6, marginTop: 12 }, children: ["Description", _jsx("textarea", { "aria-label": "Description", value: descriptionField.value ?? '', onChange: (e) => descriptionField.setValue(e.target.value), style: {
                                                        display: 'block',
                                                        width: '100%',
                                                        minHeight: 88,
                                                        resize: 'vertical',
                                                    } })] }), _jsxs("fieldset", { style: { marginTop: 12 }, children: [_jsx("legend", { children: "Use With" }), configuredCollections.map((slug) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: collections.includes(slug), onChange: () => collectionsField.setValue(collections.includes(slug)
                                                                ? collections.filter((item) => item !== slug)
                                                                : [...collections, slug]) }), ' ', slug[0].toUpperCase() + slug.slice(1)] }, slug)))] })] }), _jsx("h3", { children: "Custom Fields" }), _jsx(CustomFieldsPanel, { fields: customFields, setFields: (next) => {
                                        record();
                                        modified.current = true;
                                        customFieldsField.setValue(next);
                                    } })] }), selectionKey: editing?.id ?? adding?.value, libraryOpen: sidebar.open, onLibraryOpenChange: sidebar.setOpen, libraryTitle: "", libraryNavigation: null, library: null, sidebarControls: _jsx(SidebarControls, { state: sidebar, canInsert: !disabled }), sidebar: _jsx(BuilderSidebar, { state: sidebar, adapter: {
                                nodes: templateSidebarNodes(nodes),
                                selected: sidebarSelected ?? editing?.id,
                                canEdit: !disabled,
                                items: [
                                    ...listBlockDefinitions('template')
                                        .filter((def) => def.type !== 'column' &&
                                        !coreEditorElements.some((item) => item.label === def.label || item.value === def.type))
                                        .map((def) => ({
                                        kind: 'registered',
                                        value: def.type,
                                        label: def.label,
                                        category: def.category,
                                    })),
                                    ...coreEditorElements.map((item) => ({
                                        ...toLibraryItem(item),
                                        category: editorCategoryLabels[item.category],
                                        keywords: item.keywords,
                                    })),
                                    ...types.map((type) => ({
                                        kind: 'block',
                                        value: String(type.id),
                                        label: type.name,
                                        category: 'Designed Blocks',
                                    })),
                                ],
                                onSelect: (id) => {
                                    setSidebarSelected(id);
                                    const node = findTemplateNode(nodes, id);
                                    if (node)
                                        actions.edit(node);
                                    else {
                                        setEditing(null);
                                        setAdding(null);
                                    }
                                },
                                onInsert: (item, target) => startAdd(item, target.parent, target.before),
                                onMove: (id, target) => setNodes(moveTemplateNodeTo(nodes, id, target.parent, target.before)),
                                onDelete: actions.remove,
                                onDuplicate: (id) => {
                                    const node = findTemplateNode(nodes, id);
                                    const position = locateSidebar(templateSidebarNodes(nodes), id);
                                    if (node && position) {
                                        const copy = duplicateBuilderNode(node);
                                        setNodes(insertTemplateNode(nodes, position.parent, copy, position.siblings[position.index + 1]?.id));
                                        actions.edit(copy);
                                    }
                                },
                            } }), canvasNotice: error && _jsx("p", { role: "alert", children: error }), canvasLabel: "Template Canvas", canvasTitle: "Template Canvas", canvas: _jsx(BuilderPreviewFrame, { viewport: viewport, children: _jsxs(DropArea, { id: "root", label: "Template Canvas drop area", add: () => openPickerFor('root'), addItem: (item) => startAdd(item, 'root'), children: [!nodes.length && !legacy.length && (_jsx("div", { className: "template-editor__empty", children: _jsx("p", { children: "Add the first block to this template." }) })), _jsx(BuilderCanvasTree, { nodes: nodes, actions: actions, describe: (node) => ({
                                            ...describeTemplateNode(node, actions, viewport, previews),
                                            before: !disabled &&
                                                variationChooser === node.id &&
                                                node.type === 'layout' &&
                                                node.block ? (_jsx(VariationPicker, { node: templateBlockValue(node), initial: true, onChange: (next) => setNodes(updateTemplateNode(nodes, node.id, () => toTemplateBlock(next))), onDone: () => setVariationChooser('') })) : undefined,
                                            style: resolveStyle(templateStyle(node.style), viewport),
                                        }), id: (node) => node.id, selectedID: sidebarSelected ?? editing?.id }), legacy.length > 0 && (_jsxs("section", { children: [_jsx("h3", { children: "Existing Designed Blocks" }), legacy.map((section) => (_jsxs("article", { style: panel, children: [_jsx("strong", { children: section.name }), _jsx("p", { children: "Legacy live reference retained. Rebuild on the canvas when ready." })] }, section.key)))] }))] }) }), inspectorTitle: "Settings", inspector: editing?.type === 'layout' && editing.block ? (_jsx(RegisteredBlockEditor, { listings: adapterListings(nodes), bindingFields: customFields.map((field) => ({
                                path: `templateValues.${field.id}`,
                                label: field.label,
                            })), viewport: viewport, node: templateBlockValue(editing), change: (block) => setNodes(updateTemplateNode(nodes, editing.id, () => mergeTemplateBlock(editing, block)), true) })) : adding?.kind === 'registered' ? (_jsx(NewRegisteredBlock, { node: createContentNode(adding.value), cancel: () => setAdding(null), create: (block) => {
                                const node = toTemplateBlock(block);
                                setNodes(insertTemplateNode(nodes, target, node, beforeTarget));
                                setEditing(node);
                                setAdding(null);
                                sidebar.inserted();
                            } }, adding.value)) : adding || editing ? (_jsx(NodeEditor, { item: adding, node: editing, types: types, designs: designs, allowedCollections: collections, customFields: customFields, cancel: () => {
                                setAdding(null);
                                setEditing(null);
                            }, create: (node) => {
                                setNodes(insertTemplateNode(nodes, target, node, beforeTarget));
                                setAdding(null);
                                setEditing(node);
                                setSidebarSelected(node.id);
                                sidebar.inserted();
                            }, update: (node) => {
                                setNodes(updateTemplateNode(nodes, node.id, () => node), true);
                                setEditing(node);
                            } }, editing?.id ??
                            `${adding?.kind}:${adding?.value}:${target}:${beforeTarget ?? ''}`)) : (_jsx("p", { className: "template-editor__inspector-empty", children: "Select a block on the canvas or in List View to edit its settings and styles." })) }) }), _jsx(EditorHeaderPortal, { slot: "actions", children: _jsxs("div", { className: "editor-header__buttons", children: [_jsx("button", { type: "button", disabled: disabled, onClick: () => void save(false), children: "Save Draft" }), _jsx("button", { type: "button", disabled: disabled, onClick: () => void save(true), children: hasPublishedDoc ? 'Publish Changes' : 'Publish Template' })] }) })] }) }));
}
// Backward-compatible Payload component export. Existing import-map paths and
// collection configuration continue to resolve `TemplateBuilder` unchanged.
export const TemplateBuilder = ContentTemplateBuilder;
const customFieldTypeOptions = [
    { value: 'shortText', label: 'Short Text' },
    { value: 'longText', label: 'Multi Paragraph' },
    { value: 'richText', label: 'Rich Text' },
    { value: 'image', label: 'Image' },
    { value: 'images', label: 'Gallery' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'toggle', label: 'Toggle' },
    { value: 'select', label: 'Select' },
    { value: 'link', label: 'Link' },
    { value: 'relationship', label: 'Relationship' },
];
function CustomFieldsPanel({ fields, setFields, }) {
    const update = (id, changes) => setFields(fields.map((field) => (field.id === id ? { ...field, ...changes } : field)));
    const move = (index, offset) => {
        const next = [...fields];
        const target = index + offset;
        if (target < 0 || target >= next.length)
            return;
        [next[index], next[target]] = [next[target], next[index]];
        setFields(next);
    };
    const add = () => setFields([...fields, { id: uid('custom'), label: 'New field', fieldType: 'longText' }]);
    return (_jsxs("section", { className: "template-editor__fields-panel", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("h2", { children: "Custom Fields" }), _jsx("p", { children: "Define the information editors fill in after selecting this template. Bind these fields to elements on the Canvas." })] }), _jsx("button", { type: "button", className: "template-editor__primary-action", onClick: add, children: "+ Add field" })] }), !fields.length && (_jsxs("div", { className: "template-editor__fields-empty", children: [_jsx("strong", { children: "No custom fields yet" }), _jsx("p", { children: "Add a field such as an introduction, callout, image, or date." }), _jsx("button", { type: "button", onClick: add, children: "Add your first field" })] })), _jsx("div", { className: "template-editor__field-list", children: fields.map((field, index) => (_jsxs("article", { className: "template-editor__field-card", children: [_jsxs("div", { className: "template-editor__field-card-header", children: [_jsxs("div", { children: [_jsx("span", { className: "template-editor__field-index", children: index + 1 }), _jsx("strong", { children: field.label || 'Untitled field' }), _jsx("small", { children: customFieldTypeOptions.find((option) => option.value === field.fieldType)?.label })] }), _jsxs("div", { children: [_jsx("button", { type: "button", "aria-label": `Move ${field.label} up`, disabled: index === 0, onClick: () => move(index, -1), children: "\u2191" }), _jsx("button", { type: "button", "aria-label": `Move ${field.label} down`, disabled: index === fields.length - 1, onClick: () => move(index, 1), children: "\u2193" }), _jsx("button", { type: "button", "aria-label": `Duplicate ${field.label}`, onClick: () => setFields([
                                                ...fields.slice(0, index + 1),
                                                { ...field, id: uid('custom'), label: `${field.label} copy` },
                                                ...fields.slice(index + 1),
                                            ]), children: "Duplicate" }), _jsx("button", { type: "button", className: "template-editor__danger-action", "aria-label": `Remove ${field.label}`, onClick: () => setFields(fields.filter((item) => item.id !== field.id)), children: "Remove" })] })] }), _jsxs("div", { className: "template-editor__field-grid", children: [_jsxs("label", { children: ["Field label", _jsx("input", { "aria-label": `Field Label ${index + 1}`, value: field.label, onChange: (event) => update(field.id, { label: event.target.value }) })] }), _jsxs("label", { children: ["Field type", _jsx("select", { "aria-label": `Field Type ${index + 1}`, value: field.fieldType, onChange: (event) => update(field.id, { fieldType: event.target.value }), children: customFieldTypeOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("label", { className: "template-editor__field-wide", children: ["Help text", _jsx("textarea", { "aria-label": `Field Help Text ${index + 1}`, rows: 2, value: field.helpText ?? '', onChange: (event) => update(field.id, { helpText: event.target.value }) })] }), _jsxs("label", { children: ["Placeholder", _jsx("input", { "aria-label": `Field Placeholder ${index + 1}`, value: field.placeholder ?? '', onChange: (event) => update(field.id, { placeholder: event.target.value }) })] }), _jsxs("label", { className: "template-editor__checkbox", children: [_jsx("input", { type: "checkbox", checked: !!field.required, onChange: (event) => update(field.id, { required: event.target.checked }) }), ' ', "Required"] }), field.fieldType === 'select' && (_jsxs("label", { className: "template-editor__field-wide", children: ["Options ", _jsx("span", { children: "one per line" }), _jsx("textarea", { "aria-label": `Field Options ${index + 1}`, rows: 4, value: (field.options ?? []).join('\n'), onChange: (event) => update(field.id, {
                                                options: event.target.value
                                                    .split('\n')
                                                    .map((option) => option.trim())
                                                    .filter(Boolean),
                                            }) })] })), field.fieldType === 'relationship' && (_jsxs("label", { children: ["Related collection", _jsx("input", { "aria-label": `Related Collection ${index + 1}`, value: field.relationTo ?? '', placeholder: "posts", onChange: (event) => update(field.id, { relationTo: event.target.value }) })] }))] }), _jsxs("p", { className: "template-editor__field-id", children: ["Stable ID: ", field.id] })] }, field.id))) }), _jsx("p", { className: "template-editor__retention-note", children: "Removing a definition does not delete values already stored on content." })] }));
}
function NodeEditor({ item, node, types, designs, allowedCollections, customFields, cancel, create, update, }) {
    const kind = item?.kind ?? node?.type;
    const value = item?.value ??
        (node?.type === 'field'
            ? node.fieldType
            : node?.type === 'layout'
                ? node.layout
                : node?.type === 'block'
                    ? String(relationID(node.blockType))
                    : '');
    const [label, setLabel] = useState(node?.type === 'field' ? node.label : (item?.label ?? ''));
    const [required, setRequired] = useState(node?.type === 'field' && !!node.required);
    const [help, setHelp] = useState(node?.type === 'field' ? (node.helpText ?? '') : '');
    const [placeholder, setPlaceholder] = useState(node?.type === 'field' ? (node.placeholder ?? '') : '');
    const existingContent = node?.type === 'field' ? node.content : undefined;
    const [contentSource, setContentSource] = useState(existingContent?.source ?? 'custom');
    const [customFieldID, setCustomFieldID] = useState(existingContent?.source === 'customField' ? existingContent.fieldId : '');
    const [documentField, setDocumentField] = useState(existingContent?.source === 'document'
        ? existingContent.field
        : value === 'image'
            ? 'featuredImage'
            : 'title');
    const [staticValue, setStaticValue] = useState(existingContent?.source === 'static'
        ? existingContent.value
        : node?.type === 'field'
            ? (node.placeholder ?? '')
            : '');
    const [ratio, setRatio] = useState(node?.type === 'layout' && node.layout === 'columns'
        ? (node.columns?.map((column) => column.width).join('/') ?? '50/50')
        : '50/50');
    const type = types.find((option) => String(option.id) === value);
    const block = node?.type === 'block' ? node : null;
    const [design, setDesign] = useState(relationID(block?.blockDesign) ?? '');
    const allowOverride = false;
    const [fields, setFields] = useState(block?.fields ?? []);
    const [mappings, setMappings] = useState(block?.slotMappings ?? {});
    const tab = 'settings';
    const [style, setStyle] = useState(node?.style ?? {});
    const documentFields = value === 'image'
        ? allowedCollections.includes('posts')
            ? [{ label: 'Featured Image', value: 'featuredImage' }]
            : []
        : [
            { label: 'Title', value: 'title' },
            { label: 'Excerpt', value: 'excerpt' },
            { label: 'Publication date', value: 'publishedAt' },
            { label: 'Author', value: 'author' },
            { label: 'Slug', value: 'slug' },
        ];
    function finish() {
        let next;
        if (kind === 'layout') {
            const layout = value;
            const oldColumns = node?.type === 'layout' && node.layout === 'columns' ? (node.columns ?? []) : [];
            next = {
                id: node?.id ?? uid('layout'),
                type: 'layout',
                layout,
                style,
                ...(layout === 'columns'
                    ? {
                        columns: ratio.split('/').map((width, index) => ({
                            id: oldColumns[index]?.id ?? uid('column'),
                            width: Number(width),
                            children: oldColumns[index]?.children ?? [],
                        })),
                    }
                    : ['spacer', 'divider'].includes(layout)
                        ? {}
                        : {
                            children: node?.type === 'layout' ? (node.children ?? []) : [],
                        }),
            };
        }
        else if (kind === 'field') {
            if (contentSource === 'customField' && !customFieldID)
                return;
            const content = contentSource === 'static'
                ? { source: 'static', value: staticValue }
                : contentSource === 'document'
                    ? {
                        source: 'document',
                        field: documentField,
                        preview: staticValue || undefined,
                    }
                    : contentSource === 'customField'
                        ? {
                            source: 'customField',
                            fieldId: customFieldID,
                            preview: placeholder || undefined,
                        }
                        : { source: 'custom' };
            next = {
                id: node?.id ?? uid('field'),
                type: 'field',
                fieldType: value,
                label: label || item?.label || 'Untitled',
                required,
                helpText: help,
                placeholder: contentSource === 'static' ? staticValue : placeholder,
                content,
                style,
            };
        }
        else {
            if (!type || !design)
                return;
            next = {
                id: node?.id ?? uid('block'),
                type: 'block',
                name: type.name,
                blockType: type.id,
                blockDesign: design,
                allowDesignOverride: allowOverride,
                fields,
                slotMappings: mappings,
                style,
            };
        }
        if (node)
            update(next);
        else
            create(next);
    }
    const contentRevision = JSON.stringify([
        label,
        required,
        help,
        placeholder,
        contentSource,
        customFieldID,
        documentField,
        staticValue,
        ratio,
        design,
        fields,
        mappings,
    ]);
    const previousContent = useRef(contentRevision);
    const commitContent = useRef(finish);
    commitContent.current = finish;
    useEffect(() => {
        if (previousContent.current === contentRevision)
            return;
        previousContent.current = contentRevision;
        if (node)
            commitContent.current();
    }, [contentRevision, node]);
    function mapSlot(slot) {
        const old = mappings[slot.key];
        if (old) {
            setMappings(Object.fromEntries(Object.entries(mappings).filter(([key]) => key !== slot.key)));
            setFields(fields.filter((field) => field.id !== old));
            return;
        }
        const field = {
            id: uid('field'),
            type: 'field',
            fieldType: slot.kind === 'media'
                ? 'image'
                : slot.kind === 'textarea'
                    ? 'longText'
                    : slot.kind === 'boolean'
                        ? 'toggle'
                        : 'shortText',
            label: slot.label,
            required: !!slot.required,
        };
        setFields([...fields, field]);
        setMappings({ ...mappings, [slot.key]: field.id });
    }
    const control = { display: 'grid', gap: 6 };
    return (_jsxs("section", { "aria-label": "Configure element", children: [_jsxs(UnifiedBlockInspector, { node: {
                    id: node?.id ?? 'new',
                    label: item?.label ??
                        (node?.type === 'field'
                            ? node.label
                            : node?.type === 'block'
                                ? node.name
                                : node?.layout),
                    kind: kind === 'layout'
                        ? value === 'container' || value === 'stack'
                            ? 'group'
                            : value
                        : ({ shortText: 'heading', longText: 'paragraph', image: 'image' }[value] ?? value),
                    styles: templateStyle(style),
                    presentation: style.presentation,
                    anchor: style.anchor,
                }, onChange: (patch) => {
                    const next = {
                        ...style,
                        ...(patch.styles ? { responsive: patch.styles } : {}),
                        ...(patch.presentation ? { presentation: patch.presentation } : {}),
                        ...(patch.anchor !== undefined ? { anchor: patch.anchor } : {}),
                    };
                    setStyle(next);
                    if (node)
                        update({ ...node, style: next });
                }, children: [tab === 'settings' && kind === 'field' && (_jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Block label" }), _jsx("input", { "aria-label": "Block Label", value: label, onChange: (e) => setLabel(e.target.value), style: { width: '100%' } })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Content source" }), _jsxs("select", { "aria-label": "Content Source", value: contentSource, onChange: (event) => setContentSource(event.target.value), children: [_jsx("option", { value: "customField", children: "Template custom field" }), _jsxs("option", { value: "document", children: [allowedCollections.includes('pages') && !allowedCollections.includes('posts')
                                                        ? 'Page'
                                                        : 'Post', ' ', "field"] }), _jsx("option", { value: "static", children: "Static template text" }), _jsx("option", { value: "custom", children: "Legacy canvas field" })] })] }), contentSource === 'customField' && (_jsxs("label", { style: control, children: [_jsx("span", { children: "Custom field" }), _jsxs("select", { "aria-label": "Custom Field", value: customFieldID, onChange: (event) => setCustomFieldID(event.target.value), children: [_jsx("option", { value: "", children: "Choose a custom field" }), customFields.map((field) => (_jsx("option", { value: field.id, children: field.label }, field.id)))] }), !customFields.length && (_jsx("small", { children: "Create fields in the Custom Fields tab first." }))] })), contentSource === 'document' && (_jsxs("label", { style: control, children: [_jsx("span", { children: "Document field" }), _jsx("select", { "aria-label": "Document Field", value: documentField, onChange: (event) => setDocumentField(event.target.value), children: documentFields.map((field) => (_jsx("option", { value: field.value, children: field.label }, field.value))) })] })), contentSource === 'static' && (_jsxs("label", { style: control, children: [_jsx("span", { children: "Text" }), _jsx("input", { "aria-label": "Static Text", value: staticValue, onChange: (event) => setStaticValue(event.target.value) })] })), contentSource === 'document' && value !== 'image' && (_jsxs("label", { style: control, children: [_jsx("span", { children: "Preview text" }), _jsx("input", { "aria-label": "Preview Text", value: staticValue, placeholder: `Sample ${documentField}`, onChange: (event) => setStaticValue(event.target.value) })] })), (contentSource === 'custom' || contentSource === 'customField') && (_jsxs("label", { style: control, children: [_jsx("span", { children: "Preview text" }), _jsx("input", { "aria-label": "Placeholder", value: placeholder, onChange: (e) => setPlaceholder(e.target.value), style: { width: '100%' } })] })), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: required, onChange: (e) => setRequired(e.target.checked) }), ' ', "Required"] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Help text" }), _jsx("textarea", { "aria-label": "Help Text", value: help, onChange: (e) => setHelp(e.target.value), rows: 3, style: { width: '100%', resize: 'vertical' } })] }), _jsx("p", { style: { margin: 0, color: 'var(--theme-elevation-600)', fontSize: 12 }, children: "The Block Label identifies this element in List View. It is not rendered on the page." })] })), tab === 'settings' && kind === 'layout' && value === 'columns' && (_jsxs("div", { children: [_jsx("h3", { style: { marginTop: 0 }, children: "Choose a variation" }), _jsx("div", { role: "radiogroup", "aria-label": "Column Layout", style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }, children: columnRatios.map((option) => (_jsxs("button", { type: "button", role: "radio", "aria-checked": ratio === option, onClick: () => setRatio(option), style: {
                                        padding: 10,
                                        border: ratio === option
                                            ? '2px solid var(--theme-success-500)'
                                            : '1px solid var(--theme-elevation-250)',
                                        borderRadius: 6,
                                        background: ratio === option ? 'var(--theme-elevation-100)' : 'transparent',
                                    }, children: [_jsx("span", { "aria-hidden": "true", style: {
                                                display: 'grid',
                                                gridTemplateColumns: option
                                                    .split('/')
                                                    .map((width) => `${width}fr`)
                                                    .join(' '),
                                                gap: 3,
                                                height: 30,
                                                marginBottom: 6,
                                            }, children: option.split('/').map((_, index) => (_jsx("span", { style: {
                                                    display: 'block',
                                                    border: '1px solid currentColor',
                                                    borderRadius: 2,
                                                } }, index))) }), option] }, option))) })] })), tab === 'settings' && kind === 'layout' && value !== 'columns' && (_jsx("p", { children: "Use the Style tab to control this layout\u2019s presentation." })), tab === 'settings' && kind === 'block' && type && (_jsxs("div", { style: { display: 'grid', gap: 14 }, children: [_jsxs("p", { children: ["Component: ", _jsx("strong", { children: type.name })] }), _jsxs("label", { style: control, children: [_jsx("span", { children: "Design" }), _jsxs("select", { "aria-label": "Design", value: String(design), onChange: (e) => setDesign(designs.find((option) => String(option.id) === e.target.value)?.id ?? ''), style: { width: '100%' }, children: [_jsx("option", { value: "", children: "Choose Design" }), designs
                                                .filter((option) => String(relationID(option.blockType)) === String(type.id))
                                                .map((option) => (_jsx("option", { value: String(option.id), children: option.name }, option.id)))] })] }), _jsx("h3", { children: "Content mapping" }), (type.fields ?? []).map((slot) => {
                                const mapped = fields.find((field) => field.id === mappings[slot.key]);
                                return (_jsxs("section", { style: { ...panel, padding: 10 }, children: [_jsx("strong", { children: slot.label }), ' ', _jsx("button", { type: "button", onClick: () => mapSlot(slot), children: mapped ? 'Remove mapped field' : 'Add / Map Field' }), mapped && (_jsxs("div", { style: { display: 'grid', gap: 10, marginTop: 10 }, children: [_jsxs("label", { style: control, children: [_jsx("span", { children: "Field label" }), _jsx("input", { "aria-label": `${slot.label} Field Label`, value: mapped.label, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id
                                                                ? { ...field, label: event.target.value }
                                                                : field)) })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!mapped.required, onChange: (event) => setFields(fields.map((field) => field.id === mapped.id
                                                                ? { ...field, required: event.target.checked }
                                                                : field)) }), ' ', "Required"] })] }))] }, slot.key));
                            })] }))] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 18 }, children: [_jsx("button", { type: "button", onClick: finish, children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] })] }));
}
