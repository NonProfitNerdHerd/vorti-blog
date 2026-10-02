'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit returns callback refs and live drag state. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RenderFields, UploadInput, RelationshipInput, useConfig, useDocumentInfo, useField, useForm, useFormFields, useNav, } from '@payloadcms/ui';
import { RenderLexical } from '@payloadcms/richtext-lexical/client';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { BuilderPanels } from '../builder/BuilderWorkspace.js';
import { BuilderCore } from '../builder/BuilderCore.js';
import { builderCapabilities } from '../builder/contracts.js';
import { BlockStyleControls } from '../builder/BlockStyleControls.js';
import { ContentBlock } from '../content/ContentRenderer.js';
import { containerKinds, contentLibrary, createContentNode, duplicateContent, insertContent, moveContent, removeContent, updateContent, walkContent, textDocument, } from '../content/model.js';
import { readPath, templateContentNodes } from '../content/template-adapter.js';
import './content-workspace.css';
const relationID = (value) => value && typeof value === 'object'
    ? String(value.id)
    : value
        ? String(value)
        : '';
const blankRichText = {
    root: {
        type: 'root',
        children: [
            { type: 'paragraph', children: [], direction: null, format: '', indent: 0, version: 1 },
        ],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
    },
};
async function docs(url) {
    const result = [];
    let page = 1;
    while (page) {
        const response = await fetch(`${url}&page=${page}`, { credentials: 'same-origin' });
        if (!response.ok)
            throw new Error('Could not load the editor library. Reload to retry.');
        const batch = await response.json();
        result.push(...batch.docs);
        page = batch.nextPage;
    }
    return result;
}
export const ContentWorkspace = (props) => {
    const { field, groups, lexicalSchemaPath, readOnly, permissions, indexPath, schemaPath } = props;
    const { collectionSlug } = useDocumentInfo();
    const { disabled } = useForm();
    const [ready, setReady] = useState(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR controls must stay disabled until event handlers are hydrated.
    useEffect(() => setReady(true), []);
    const lockedForm = Boolean(readOnly || disabled || !ready);
    const nav = useNav();
    const didCollapse = useRef(false);
    useEffect(() => {
        if (nav.hydrated && !didCollapse.current) {
            didCollapse.current = true;
            nav.setNavOpen(false);
        }
    }, [nav]);
    const layoutField = useField({ path: 'contentLayout' });
    const valuesField = useField({ path: 'templateValues' });
    const templateField = useField({ path: 'designTemplate' });
    const allFields = useFormFields(([fields]) => fields);
    const document = useMemo(() => Object.fromEntries(Object.entries(allFields).map(([key, value]) => [key, value.value])), [allFields]);
    const templateID = relationID(templateField.value);
    const locked = Boolean(templateID);
    const capabilities = builderCapabilities(locked ? 'template-content' : 'freeform', lockedForm);
    const [template, setTemplate] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [types, setTypes] = useState([]);
    const [designs, setDesigns] = useState([]);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState('');
    const [panel, setPanel] = useState('document');
    const [left, setLeft] = useState(true);
    const [right, setRight] = useState(true);
    useEffect(() => {
        const narrow = window.matchMedia('(max-width: 1100px)');
        const closeDrawers = () => {
            if (narrow.matches) {
                setLeft(false);
                setRight(false);
            }
        };
        closeDrawers();
        narrow.addEventListener('change', closeDrawers);
        return () => narrow.removeEventListener('change', closeDrawers);
    }, []);
    const [libraryMode, setLibraryMode] = useState('blocks');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('All');
    const [viewport, setViewport] = useState('desktop');
    const [destination, setDestination] = useState({
        parent: 'root',
    });
    const history = useRef({
        past: [],
        future: [],
        last: 0,
    });
    const [, setRevision] = useState(0);
    const [mediaCache, setMediaCache] = useState({});
    const current = { layout: layoutField.value ?? null, values: valuesField.value ?? {} };
    const nodes = useMemo(() => locked
        ? template && String(template.id) === templateID
            ? templateContentNodes(template, document, types, designs, true)
            : []
        : (layoutField.value?.nodes ??
            (document.content
                ? [
                    {
                        id: 'legacy_content',
                        kind: 'richText',
                        label: 'Existing content',
                        richText: document.content,
                    },
                ]
                : [])), [locked, template, templateID, document, types, designs, layoutField.value]);
    const active = walkContent(nodes).find((node) => node.id === selected);
    const select = (id) => {
        setSelected(id);
        setPanel('block');
        setRight(true);
        if (window.matchMedia('(max-width: 1100px)').matches)
            setLeft(false);
    };
    const selectAndScroll = (id) => {
        select(id);
        window.document
            .getElementById(`editor-${id}`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    useEffect(() => {
        let alive = true;
        Promise.all([
            docs(`/api/design-templates?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published&where[allowedCollections][contains]=${collectionSlug}`),
            docs('/api/design-block-types?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published'),
            docs('/api/design-block-designs?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published'),
        ])
            .then(([templates, types, designs]) => {
            if (alive) {
                setTemplates(templates);
                setTypes(types);
                setDesigns(designs);
            }
        })
            .catch((cause) => {
            if (alive)
                setError(String(cause.message));
        });
        return () => {
            alive = false;
        };
    }, [collectionSlug]);
    useEffect(() => {
        if (!templateID)
            return;
        const controller = new AbortController();
        fetch(`/api/design-templates/${encodeURIComponent(templateID)}?depth=0`, {
            credentials: 'same-origin',
            signal: controller.signal,
        })
            .then((response) => {
            if (!response.ok)
                throw new Error('This template is unavailable. Select another template in document settings, or ask a designer to restore it.');
            return response.json();
        })
            .then((value) => {
            setTemplate(value);
            setError('');
        })
            .catch((cause) => {
            if (!controller.signal.aborted)
                setError(cause.message);
        });
        return () => controller.abort();
    }, [templateID]);
    // Media inside JSON is resolved explicitly; Payload relationship depth cannot populate it.
    const mediaIDs = [
        ...new Set(walkContent(nodes)
            .flatMap((node) => [
            node.media,
            ...Object.entries(node.values ?? {})
                .filter(([key]) => /image/i.test(key))
                .map(([, value]) => value),
        ])
            .flat()
            .filter((value) => typeof value === 'string' || typeof value === 'number')
            .map(String)),
    ]
        .sort()
        .join(',');
    useEffect(() => {
        let alive = true;
        Promise.all(mediaIDs
            .split(',')
            .filter(Boolean)
            .map(async (id) => {
            const response = await fetch(`/api/media/${encodeURIComponent(id)}`, {
                credentials: 'same-origin',
            });
            return [id, response.ok ? await response.json() : null];
        }))
            .then((entries) => {
            if (alive)
                setMediaCache(Object.fromEntries(entries));
        })
            .catch(() => { });
        return () => {
            alive = false;
        };
    }, [mediaIDs]);
    const resolvedNode = (node) => {
        const media = (value) => Array.isArray(value)
            ? value.map(media)
            : typeof value === 'string' || typeof value === 'number'
                ? mediaCache[String(value)]
                : value;
        const type = types.find((type) => String(type.id) === String(node.blockType));
        const design = designs.find((design) => String(design.id) === String(node.blockDesign));
        return {
            ...node,
            media: media(node.media),
            rendererKey: node.rendererKey ?? type?.rendererKey,
            design: node.design ?? design?.design,
            values: Object.fromEntries(Object.entries(node.values ?? {}).map(([key, value]) => [
                key,
                /image/i.test(key) ? media(value) : value,
            ])),
        };
    };
    function commit(next, typing = false) {
        if (lockedForm)
            return;
        if (JSON.stringify(next) === JSON.stringify(current))
            return;
        // eslint-disable-next-line react-hooks/purity -- commit is called only by input/drag handlers, never during render.
        const now = Date.now();
        if (!typing || now - history.current.last > 700)
            history.current.past.push(structuredClone(current));
        history.current.past = history.current.past.slice(-100);
        history.current.future = [];
        history.current.last = typing ? now : 0;
        if (!locked)
            layoutField.setValue(next.layout);
        valuesField.setValue(next.values);
        setRevision((value) => value + 1);
    }
    function setNodes(next, typing = false) {
        if (capabilities.editStructure)
            commit({ ...current, layout: { version: 1, nodes: next } }, typing);
    }
    function changeNode(id, patch, typing = false) {
        const previous = walkContent(nodes).find((node) => node.id === id);
        if (!previous ||
            Object.entries(patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value)))
            return;
        setNodes(updateContent(nodes, id, (node) => ({ ...node, ...patch })), typing);
    }
    function undo(redo = false) {
        const source = redo ? history.current.future : history.current.past;
        const next = source.pop();
        if (!next || lockedForm)
            return;
        (redo ? history.current.past : history.current.future).push(structuredClone(current));
        history.current.last = 0;
        if (!locked)
            layoutField.setValue(next.layout);
        valuesField.setValue(next.values);
        setRevision((value) => value + 1);
    }
    function add(kind, parent = destination.parent, before = destination.before, type) {
        const node = createContentNode(kind);
        if (type) {
            node.blockType = type.id;
            node.rendererKey = type.rendererKey;
            node.label = type.name;
            node.blockDesign = designs.find((design) => relationID(design.blockType) === String(type.id))?.id;
            node.values = {};
        }
        setNodes(insertContent(nodes, node, parent, before));
        select(node.id);
    }
    function changeTemplate(next) {
        if (next === templateID)
            return;
        if ((nodes.length || Object.keys(current.values).length) &&
            !window.confirm('Change the template? The active layout will change. Existing content is retained so you can switch back.'))
            return;
        templateField.setValue(templates.find((template) => String(template.id) === next)?.id ?? null);
        setSelected('');
        setPanel('document');
        history.current = { past: [], future: [], last: 0 };
        setError('');
    }
    const renderFields = (names) => (_jsx(RenderFields, { fields: field.fields.filter((item) => 'name' in item && names.includes(item.name ?? '')), parentIndexPath: indexPath ?? '0', parentPath: "", parentSchemaPath: schemaPath ?? '', permissions: permissions ?? {}, readOnly: lockedForm, forceRender: true }));
    const internal = new Set([
        'title',
        'content',
        'contentLayout',
        'templateValues',
        'designOverrides',
        'responsiveDesigns',
        'designTemplate',
    ]);
    const gear = (_jsxs(_Fragment, { children: [_jsxs("details", { open: true, children: [_jsx("summary", { children: "Template" }), _jsxs("label", { children: ["Template", _jsxs("select", { "aria-label": "Template", disabled: lockedForm || templateField.disabled, value: templateID, onChange: (event) => changeTemplate(event.target.value), children: [_jsx("option", { value: "", children: "No template \u2014 freeform blocks" }), templates.map((template) => (_jsx("option", { value: template.id, children: template.name }, template.id))), templateID && !templates.some((template) => String(template.id) === templateID) && (_jsx("option", { value: templateID, children: "Current template (unavailable)" }))] })] }), renderFields((groups.Template ?? []).filter((name) => !internal.has(name)))] }), Object.entries(groups)
                .filter(([name]) => name !== 'Template' && name !== 'Content')
                .map(([name, names]) => {
                const visible = names.filter((name) => !internal.has(name));
                return visible.length ? (_jsxs("details", { open: true, children: [_jsx("summary", { children: name }), renderFields(visible)] }, name)) : null;
            })] }));
    const bindField = (node) => node.binding && !node.binding.path.startsWith('templateValues.') ? (_jsx(React.Fragment, { children: renderFields([node.binding.path]) }, node.id)) : (_jsxs(React.Fragment, { children: [node.binding?.helpText && _jsx("p", { children: node.binding.helpText }), _jsx(BoundValue, { node: node, document: document, lexicalSchemaPath: lexicalSchemaPath, disabled: lockedForm, onValues: (path, value) => {
                    const next = structuredClone(current.values);
                    const segments = path.replace(/^templateValues\./, '').split('.');
                    let cursor = next;
                    for (const key of segments.slice(0, -1))
                        cursor = (cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {}));
                    cursor[segments.at(-1)] = value;
                    commit({ ...current, values: next }, true);
                } }, node.id)] }, node.id));
    const editorBody = (node) => {
        if (locked)
            return node.binding ? (bindField(node)) : node.kind === 'designed' ? (_jsxs(_Fragment, { children: [_jsx(ContentBlock, { node: resolvedNode(node), viewport: viewport }), node.fields?.map(bindField)] })) : undefined;
        if (['heading', 'paragraph', 'quote', 'list'].includes(node.kind))
            return node.richText ? (_jsx(RenderLexical, { field: {
                    name: 'content',
                    type: 'richText',
                    label: node.label,
                    admin: { readOnly: lockedForm },
                }, path: `editorText.${node.id}`, schemaPath: lexicalSchemaPath, value: node.richText, setValue: (richText) => changeNode(node.id, { richText }, true) })) : (_jsxs(_Fragment, { children: [_jsx(InlineText, { node: node, disabled: lockedForm, onChange: (text) => changeNode(node.id, { text }, true) }), selected === node.id && (_jsx("button", { type: "button", disabled: lockedForm, onClick: () => changeNode(node.id, { richText: textDocument(node) }), children: "Format text" }))] }));
        if (node.kind === 'richText')
            return (_jsx(RenderLexical, { field: {
                    name: 'content',
                    type: 'richText',
                    label: false,
                    admin: { readOnly: lockedForm },
                }, path: `contentLayout.${node.id}`, schemaPath: lexicalSchemaPath, value: (node.richText ?? blankRichText), setValue: (richText) => changeNode(node.id, { richText }, true) }));
        if (['image', 'gallery'].includes(node.kind) && !node.media)
            return (_jsxs("button", { type: "button", onClick: () => select(node.id), children: ["Choose ", node.kind] }));
        return undefined;
    };
    const tree = (items, parent = 'root') => (_jsxs(_Fragment, { children: [items.map((node) => (_jsxs(React.Fragment, { children: [!locked && (_jsx(Insertion, { parent: parent, before: node.id, disabled: lockedForm, onChoose: () => {
                            setDestination({ parent, before: node.id });
                            setLeft(true);
                            setLibraryMode('blocks');
                        } })), _jsx(EditableNode, { node: node, selected: selected === node.id, locked: locked || lockedForm, onSelect: () => select(node.id), onMove: (direction) => {
                            const index = items.findIndex((item) => item.id === node.id);
                            const target = direction === -1 ? items[index - 1]?.id : items[index + 2]?.id;
                            if ((direction === -1 && index === 0) ||
                                (direction === 1 && index === items.length - 1))
                                return;
                            setNodes(moveContent(nodes, node.id, parent, target));
                        }, onDuplicate: () => {
                            const copy = duplicateContent(node);
                            setNodes(insertContent(nodes, copy, parent, items[items.indexOf(node) + 1]?.id));
                            select(copy.id);
                        }, onRemove: () => {
                            setNodes(removeContent(nodes, node.id));
                            setSelected('');
                        }, children: _jsx(ContentBlock, { node: resolvedNode(node), viewport: viewport, body: editorBody(node), children: containerKinds.has(node.kind) && tree(node.children ?? [], node.id) }) })] }, node.id))), !locked && (_jsx(Insertion, { parent: parent, disabled: lockedForm, onChoose: () => {
                    setDestination({ parent });
                    if (items.length === 0 &&
                        parent !== 'root' &&
                        walkContent(nodes).find((node) => node.id === parent)?.kind === 'columns')
                        add('column', parent);
                    else {
                        setLeft(true);
                        setLibraryMode('blocks');
                    }
                } }))] }));
    const issues = Object.entries(allFields).filter(([, value]) => value.valid === false && value.errorMessage);
    return (_jsx(BuilderCore, { id: "content-workspace", onInsert: (item, parent, before) => add(item.kind, parent, before, types.find((type) => String(type.id) === item.value)), onMove: (id, parent, before) => {
            if (!locked)
                setNodes(moveContent(nodes, id, parent, before));
        }, children: _jsxs("section", { className: "content-workspace", onKeyDown: (event) => {
                if (event.key === 'Escape' && window.matchMedia('(max-width: 1100px)').matches) {
                    setLeft(false);
                    setRight(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                    event.preventDefault();
                    event.stopPropagation();
                    undo(event.shiftKey);
                }
            }, children: [_jsxs("div", { className: "content-workspace__toolbar", children: [_jsx("button", { type: "button", "aria-expanded": nav.navOpen, onClick: () => nav.setNavOpen(!nav.navOpen), children: "Menu" }), _jsx("button", { type: "button", "aria-expanded": left, onClick: () => {
                                setLeft(!left);
                                if (window.matchMedia('(max-width: 1100px)').matches)
                                    setRight(false);
                            }, children: "Blocks / List view" }), _jsx("button", { type: "button", disabled: !history.current.past.length || lockedForm, onClick: () => undo(), children: "Undo" }), _jsx("button", { type: "button", disabled: !history.current.future.length || lockedForm, onClick: () => undo(true), children: "Redo" }), _jsx("select", { "aria-label": "Preview width", value: viewport, onChange: (event) => setViewport(event.target.value), children: ['desktop', 'tablet', 'mobile'].map((device) => (_jsx("option", { children: device }, device))) }), _jsx("button", { type: "button", "aria-expanded": right, onClick: () => {
                                setRight(!right);
                                if (window.matchMedia('(max-width: 1100px)').matches)
                                    setLeft(false);
                            }, children: "Inspector" })] }), error && _jsx("p", { role: "alert", children: error }), issues.length > 0 && (_jsx("div", { role: "alert", children: issues.map(([path, value]) => (_jsx("button", { type: "button", onClick: () => {
                            const affected = walkContent(nodes).find((node) => node.binding?.path === path ||
                                path.includes(node.id) ||
                                node.fields?.some((field) => field.binding?.path === path));
                            if (affected)
                                selectAndScroll(affected.id);
                            else {
                                setPanel('document');
                                setRight(true);
                                requestAnimationFrame(() => {
                                    const input = window.document.getElementById(`field-${path.replaceAll('.', '__')}`);
                                    input?.scrollIntoView({ block: 'center' });
                                    input?.focus();
                                });
                            }
                        }, children: String(value.errorMessage) }, path))) })), _jsxs(BuilderPanels, { className: "content-workspace__layout", leftOpen: left, rightOpen: right, children: [left && (_jsxs("aside", { className: "content-workspace__left", "aria-label": "Block library and hierarchy", children: [_jsx("button", { type: "button", onClick: () => setLeft(false), children: "Close left panel" }), _jsxs("div", { role: "tablist", "aria-label": "Blocks and hierarchy", children: [!locked && (_jsx("button", { type: "button", role: "tab", "aria-selected": libraryMode === 'blocks', onClick: () => setLibraryMode('blocks'), children: "Blocks" })), _jsx("button", { type: "button", role: "tab", "aria-selected": locked || libraryMode === 'list', onClick: () => setLibraryMode('list'), children: "List view" })] }), locked || libraryMode === 'list' ? (_jsx(Hierarchy, { nodes: nodes, selected: selected, locked: locked || lockedForm, onSelect: selectAndScroll, onMove: (id, parent, before) => setNodes(moveContent(nodes, id, parent, before)) })) : (_jsxs(_Fragment, { children: [_jsx("input", { "aria-label": "Search blocks", placeholder: "Search blocks\u2026", value: query, onChange: (event) => setQuery(event.target.value) }), _jsx("select", { "aria-label": "Block category", value: category, onChange: (event) => setCategory(event.target.value), children: ['All', 'Text', 'Media', 'Layout', 'Designed Blocks'].map((value) => (_jsx("option", { children: value }, value))) }), _jsxs("p", { children: ["Insert into", ' ', destination.parent === 'root'
                                                    ? 'document'
                                                    : (walkContent(nodes).find((node) => node.id === destination.parent)?.label ??
                                                        'container')] }), contentLibrary
                                            .filter((item) => (category === 'All' || category === item.category) &&
                                            item.label.toLowerCase().includes(query.toLowerCase()))
                                            .map((item) => (_jsx(LibraryItem, { kind: item.kind, label: item.label, disabled: lockedForm, onClick: () => add(item.kind) }, item.kind))), (category === 'All' || category === 'Designed Blocks') &&
                                            types
                                                .filter((type) => type.rendererKey === 'hero-board' &&
                                                type.name.toLowerCase().includes(query.toLowerCase()))
                                                .map((type) => (_jsx(LibraryItem, { kind: "designed", value: String(type.id), label: type.name, disabled: lockedForm, onClick: () => add('designed', destination.parent, destination.before, type) }, type.id)))] }))] })), _jsxs("div", { className: "content-workspace__center", children: [_jsx("div", { className: "content-workspace__title", children: renderFields(['title']) }), _jsx("div", { className: "content-workspace__viewport", "data-viewport": viewport, style: {
                                        maxWidth: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : undefined,
                                    }, children: locked && (!template || String(template.id) !== templateID) ? (_jsx("p", { children: "Loading template\u2026" })) : (tree(nodes)) })] }), right && (_jsxs("aside", { className: "content-workspace__right", "aria-label": "Inspector", children: [_jsx("button", { type: "button", onClick: () => setRight(false), children: "Close inspector" }), _jsxs("div", { role: "tablist", "aria-label": "Inspector tabs", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": panel === 'block', onClick: () => setPanel('block'), children: "Block" }), _jsx("button", { type: "button", role: "tab", "aria-label": "Document settings", title: "Document settings", "aria-selected": panel === 'document', onClick: () => setPanel('document'), children: "\u2699" })] }), panel === 'document' ? (gear) : !active ? (_jsx("p", { children: "Select a block on the canvas or in List view." })) : (_jsxs(_Fragment, { children: [_jsx("h3", { children: active.label ?? active.kind }), locked ? (_jsxs(_Fragment, { children: [_jsx("p", { children: "Template structure and design are locked." }), active.binding
                                                    ? bindField(active)
                                                    : (active.fields?.map(bindField) ?? (_jsx("p", { children: "This element has no editable fields." })))] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Move block into", _jsxs("select", { "aria-label": "Move block into", value: "", disabled: lockedForm, onChange: (event) => {
                                                                if (event.target.value)
                                                                    setNodes(moveContent(nodes, active.id, event.target.value));
                                                            }, children: [_jsx("option", { value: "", children: "Choose destination?" }), active.kind !== 'column' && _jsx("option", { value: "root", children: "Document" }), walkContent(nodes)
                                                                    .filter((node) => containerKinds.has(node.kind) &&
                                                                    (node.kind === 'columns') === (active.kind === 'column') &&
                                                                    !walkContent([active]).some((child) => child.id === node.id))
                                                                    .map((node) => (_jsx("option", { value: node.id, children: node.label ?? node.kind }, node.id)))] })] }), _jsx(BlockInspector, { node: active, disabled: lockedForm, viewport: viewport, designs: designs, types: types, onChange: (patch) => changeNode(active.id, patch) })] }))] }))] }))] })] }) }));
};
function InlineText({ node, disabled, onChange, }) {
    return (_jsx("textarea", { className: `content-workspace__inline content-workspace__inline--${node.kind}`, "aria-label": node.label ?? node.kind, placeholder: `Type ${node.kind}…`, value: node.text ?? '', readOnly: disabled, rows: node.kind === 'heading' ? 1 : 3, onChange: (event) => onChange(event.target.value) }));
}
function Insertion({ parent, before, disabled, onChoose, }) {
    const drop = useDroppable({
        id: `insert:${parent}:${before ?? 'end'}`,
        data: { containerID: parent, beforeID: before },
        disabled,
    });
    return (_jsx("div", { ref: drop.setNodeRef, className: "content-workspace__insert", "data-over": drop.isOver, children: _jsx("button", { type: "button", disabled: disabled, "aria-label": `Insert block ${before ? 'before block' : 'at end'}`, onClick: onChoose, children: "+" }) }));
}
function LibraryItem({ kind, value, label, disabled, onClick, }) {
    const drag = useDraggable({
        id: `library:${kind}:${value ?? ''}`,
        data: { library: { kind, value: value ?? kind, label } },
        disabled,
    });
    return (_jsxs("div", { className: "content-workspace__library-item", children: [_jsx("button", { ref: drag.setNodeRef, type: "button", disabled: disabled, ...drag.attributes, ...drag.listeners, "aria-label": `Drag ${label}`, children: "\u283F" }), _jsx("button", { type: "button", disabled: disabled, onClick: onClick, children: label })] }));
}
function EditableNode({ node, selected, locked, onSelect, onMove, onDuplicate, onRemove, children, }) {
    const drag = useDraggable({ id: `node:${node.id}`, data: { nodeID: node.id }, disabled: locked });
    return (_jsxs("section", { id: `editor-${node.id}`, ref: drag.setNodeRef, className: "content-workspace__node", "data-selected": selected, "aria-label": node.label ?? node.kind, onClick: (event) => {
            event.stopPropagation();
            onSelect();
        }, onFocus: (event) => {
            event.stopPropagation();
            onSelect();
        }, children: [_jsxs("div", { className: "content-workspace__node-controls", children: [_jsxs("button", { type: "button", onClick: onSelect, children: [locked ? '🔒 ' : '', node.label ?? node.kind] }), !locked && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", ...drag.attributes, ...drag.listeners, "aria-label": `Drag ${node.label ?? node.kind}`, children: "\u283F" }), _jsx("button", { type: "button", "aria-label": "Move block up", onClick: () => onMove(-1), children: "\u2191" }), _jsx("button", { type: "button", "aria-label": "Move block down", onClick: () => onMove(1), children: "\u2193" }), _jsx("button", { type: "button", onClick: onDuplicate, children: "Duplicate" }), _jsx("button", { type: "button", onClick: onRemove, children: "Remove" })] }))] }), children] }));
}
function Hierarchy({ nodes, selected, locked, onSelect, onMove, parent = 'root', }) {
    return (_jsx("ul", { className: "content-workspace__hierarchy", children: nodes.map((node, index) => (_jsxs("li", { children: [_jsx(HierarchyRow, { node: node, parent: parent, selected: selected === node.id, locked: locked, onSelect: () => onSelect(node.id), onMove: (direction) => {
                        if ((direction === -1 && index === 0) ||
                            (direction === 1 && index === nodes.length - 1))
                            return;
                        onMove(node.id, parent, direction === -1 ? nodes[index - 1]?.id : nodes[index + 2]?.id);
                    } }), node.children && (_jsxs("details", { open: true, children: [_jsx("summary", { children: "Children" }), _jsx(Hierarchy, { nodes: node.children, parent: node.id, selected: selected, locked: locked, onSelect: onSelect, onMove: onMove })] }))] }, node.id))) }));
}
function HierarchyRow({ node, parent, selected, locked, onSelect, onMove, }) {
    const drag = useDraggable({
        id: 'outline:' + node.id,
        data: { nodeID: node.id },
        disabled: locked,
    });
    const drop = useDroppable({
        id: 'outline-drop:' + node.id,
        data: { containerID: parent, beforeID: node.id },
        disabled: locked,
    });
    return (_jsxs("div", { ref: drop.setNodeRef, "data-over": drop.isOver, className: "content-workspace__outline-row", children: [_jsxs("button", { type: "button", "aria-current": selected, onClick: onSelect, children: [locked ? '?? ' : '', node.label ?? node.kind] }), !locked && (_jsxs(_Fragment, { children: [_jsx("button", { ref: drag.setNodeRef, type: "button", ...drag.attributes, ...drag.listeners, "aria-label": 'Drag ' + (node.label ?? node.kind) + ' in hierarchy', children: "?" }), _jsx("button", { type: "button", "aria-label": "Move up in hierarchy", onClick: () => onMove(-1), children: "?" }), _jsx("button", { type: "button", "aria-label": "Move down in hierarchy", onClick: () => onMove(1), children: "?" })] }))] }));
}
function MediaPicker({ value, onChange, many = false, disabled = false, label = 'Image', }) {
    const { config } = useConfig();
    return (_jsx(UploadInput, { api: config.routes.api, allowCreate: true, hasMany: many, isSortable: many, label: label, onChange: onChange, path: "editor-media", readOnly: disabled, relationTo: "media", serverURL: config.serverURL, showError: false, value: value }));
}
function BoundValue({ node, document, lexicalSchemaPath, disabled, onValues, }) {
    const binding = node.binding;
    const field = useField({
        path: binding.path,
        disableFormData: binding.path.startsWith('templateValues.'),
    });
    const value = readPath(document, binding.path);
    const update = (value) => binding.path.startsWith('templateValues.')
        ? onValues(binding.path, value)
        : field.setValue(value);
    if (binding.kind === 'image' || binding.kind === 'images')
        return (_jsx(MediaPicker, { value: value, onChange: update, many: binding.kind === 'images', disabled: disabled, label: node.label }));
    if (binding.kind === 'relationship' && binding.relationTo)
        return (_jsx(RelationshipInput, { label: node.label, relationTo: [binding.relationTo], hasMany: false, path: binding.path, readOnly: disabled, value: value
                ? {
                    relationTo: binding.relationTo,
                    value: typeof value === 'object' ? value.id : value,
                }
                : null, onChange: (next) => update(next?.value ?? null) }));
    if (binding.kind === 'richText')
        return (_jsx(RenderLexical, { field: {
                name: node.id,
                type: 'richText',
                label: node.label,
                admin: { readOnly: disabled },
            }, path: binding.path, schemaPath: lexicalSchemaPath, value: (value ?? blankRichText), setValue: update }));
    return (_jsxs("label", { children: [node.label, binding.required ? ' *' : '', binding.kind === 'toggle' ? (_jsx("input", { type: "checkbox", disabled: disabled, checked: Boolean(value), onChange: (event) => update(event.target.checked) })) : binding.kind === 'select' ? (_jsxs("select", { disabled: disabled, value: String(value ?? ''), onChange: (event) => update(event.target.value), children: [_jsx("option", { value: "", children: "Choose\u2026" }), binding.options?.map((option) => (_jsx("option", { children: option }, option)))] })) : binding.kind === 'longText' ? (_jsx("textarea", { disabled: disabled, value: String(value ?? ''), onChange: (event) => update(event.target.value) })) : (_jsx("input", { disabled: disabled, type: binding.kind === 'number' ? 'number' : binding.kind === 'date' ? 'date' : 'text', value: String(value ?? ''), onChange: (event) => update(binding.kind === 'number' && event.target.value !== ''
                    ? Number(event.target.value)
                    : event.target.value) }))] }));
}
function BlockInspector({ node, disabled, viewport, designs, types, onChange, }) {
    return (_jsxs("fieldset", { disabled: disabled, className: "content-workspace__inspector-fields", children: [_jsxs("details", { open: true, children: [_jsx("summary", { children: "Settings" }), _jsxs("label", { children: ["Block label", _jsx("input", { value: node.label ?? '', onChange: (event) => onChange({ label: event.target.value }) })] }), node.kind === 'heading' && (_jsxs("label", { children: ["Heading level", _jsx("select", { value: node.level ?? 2, onChange: (event) => onChange({ level: Number(event.target.value) }), children: [1, 2, 3, 4, 5, 6].map((level) => (_jsxs("option", { value: level, children: ["H", level] }, level))) })] })), node.kind === 'list' && (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!node.ordered, onChange: (event) => onChange({ ordered: event.target.checked }) }), "Numbered list"] })), ['button', 'video'].includes(node.kind) && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["URL", _jsx("input", { value: node.url ?? '', onChange: (event) => onChange({ url: event.target.value }) })] }), _jsxs("label", { children: ["Text", _jsx("input", { value: node.text ?? '', onChange: (event) => onChange({ text: event.target.value }) })] })] })), ['image', 'gallery'].includes(node.kind) && (_jsx(MediaPicker, { value: node.media, onChange: (media) => onChange({ media }), many: node.kind === 'gallery', disabled: disabled })), node.kind === 'image' && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Alternative text", _jsx("input", { value: node.alt ?? '', onChange: (event) => onChange({ alt: event.target.value }) })] }), _jsxs("label", { children: ["Caption", _jsx("input", { value: node.text ?? '', onChange: (event) => onChange({ text: event.target.value }) })] })] })), node.kind === 'columns' && (_jsx("button", { type: "button", onClick: () => onChange({ children: [...(node.children ?? []), createContentNode('column')] }), children: "Add column" })), node.kind === 'designed' && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Design", _jsxs("select", { value: node.blockDesign ?? '', onChange: (event) => onChange({
                                            blockDesign: designs.find((design) => String(design.id) === event.target.value)
                                                ?.id,
                                        }), children: [_jsx("option", { value: "", children: "Choose\u2026" }), designs
                                                .filter((design) => relationID(design.blockType) === String(node.blockType))
                                                .map((design) => (_jsx("option", { value: design.id, children: design.name }, design.id)))] })] }), _jsx(DesignedFields, { fields: types.find((type) => String(type.id) === String(node.blockType))?.fields ?? [], values: node.values ?? {}, disabled: disabled, onChange: (values) => onChange({ values }) })] }))] }), _jsxs("details", { children: [_jsx("summary", { children: "Style" }), _jsx(BlockStyleControls, { value: node.styles, viewport: viewport, onChange: (styles) => onChange({ styles }) })] }), _jsxs("details", { children: [_jsx("summary", { children: "Advanced" }), _jsxs("label", { children: ["HTML anchor", _jsx("input", { value: node.anchor ?? '', onChange: (event) => onChange({ anchor: event.target.value }) })] })] })] }));
}
function DesignedFields({ fields, values, disabled, onChange, }) {
    return (_jsx(_Fragment, { children: fields.map((field) => field.kind === 'group' ? (_jsxs("fieldset", { children: [_jsx("legend", { children: field.label }), _jsx(DesignedFields, { fields: field.children ?? [], values: values[field.key] ?? {}, disabled: disabled, onChange: (value) => onChange({ ...values, [field.key]: value }) })] }, field.key)) : field.kind === 'media' ? (_jsx(MediaPicker, { label: field.label, disabled: disabled, value: values[field.key], onChange: (value) => onChange({ ...values, [field.key]: value }) }, field.key)) : (_jsxs("label", { children: [field.label, _jsx("input", { disabled: disabled, value: String(values[field.key] ?? ''), onChange: (event) => onChange({ ...values, [field.key]: event.target.value }) })] }, field.key))) }));
}
