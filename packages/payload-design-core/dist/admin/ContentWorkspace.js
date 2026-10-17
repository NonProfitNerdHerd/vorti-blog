'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { InspectorTabs } from '../builder/InspectorTabs.js';
import { InlineText } from '../builder/InlineText.js';
/* eslint-disable react-hooks/refs -- dnd-kit returns callback refs and live drag state. */
import { BlockGlyph } from '../blocks/BlockGlyph.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RenderFields, UploadInput, RelationshipInput, useConfig, useDocumentInfo, useField, useForm, useFormFields, useNav, } from '@payloadcms/ui';
import { RenderLexical } from '@payloadcms/richtext-lexical/client';
import { useDroppable } from '@dnd-kit/core';
import { InspectorGesture, markInspectorGesture, InspectorToggle, } from '../builder/InspectorControls.js';
import { BuilderPanels } from '../builder/BuilderWorkspace.js';
import { BuilderCore } from '../builder/BuilderCore.js';
import { BuilderSidebar, SidebarControls, useBuilderSidebar } from '../builder/BuilderSidebar.js';
import { contentSidebarNodes, insertionTarget, locateSidebar } from '../builder/sidebar-model.js';
import { builderCapabilities } from '../builder/contracts.js';
import { getBlockDefinition } from '../blocks/registry.js';
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector.js';
import { VariationPicker } from '../builder/VariationPicker.js';
import { BackgroundMediaPicker } from '../builder/BackgroundMediaPicker.js';
import { DocumentPicker } from '../builder/DocumentPicker.js';
import { EditingSelection } from '../blocks/EditingSelection.js';
import { resolveDocumentHeadings } from '../blocks/resolve.js';
import { styleOnlyKinds, variationsFor } from '../blocks/variations.js';
import { ContentBlock } from '../content/ContentRenderer.js';
import { containerKinds, getContentLibrary, createContentNode, duplicateContent, insertContent, moveContent, removeContent, updateContent, walkContent, } from '../content/model.js';
import { readPath, templateContentNodes } from '../content/template-adapter.js';
import { EditorHeaderPortal, EditorDevices, EditorHistory } from '../builder/EditorHeader.js';
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
    const { collectionSlug, id: documentID } = useDocumentInfo();
    const { config: workspaceConfig } = useConfig();
    const singular = workspaceConfig.collections.find((c) => c.slug === collectionSlug)?.labels
        ?.singular;
    const collectionLabel = typeof singular === 'string'
        ? singular
        : (collectionSlug ?? 'Document').replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());
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
    const typeValuesField = useField({ path: 'postTypeValues' });
    const templateField = useField({ path: 'designTemplate' });
    const postTypeField = useField({ path: 'postType' });
    const postTypeID = relationID(postTypeField.value);
    const [postType, setPostType] = useState(null);
    const documentLabel = postType?.singular || collectionLabel;
    useEffect(() => {
        if (collectionSlug !== 'posts')
            return;
        const controller = new AbortController();
        const where = postTypeID ? `where[id][equals]=${encodeURIComponent(postTypeID)}` : 'where[key][equals]=post';
        fetch(`/api/post-types?${where}&where[_status][equals]=published&depth=0&draft=false`, { signal: controller.signal, credentials: 'same-origin' })
            .then(r => r.ok ? r.json() : Promise.reject(new Error('Post Type is unavailable')))
            .then(result => setPostType(result.docs?.[0] ?? null))
            .catch(() => { if (!controller.signal.aborted)
            setPostType(null); });
        return () => controller.abort();
    }, [collectionSlug, postTypeID]);
    const allFields = useFormFields(([fields]) => fields);
    const document = useMemo(() => Object.fromEntries(Object.entries(allFields).map(([key, value]) => [key, value.value])), [allFields]);
    const templateID = relationID(templateField.value) || relationID(postType?.defaultTemplate);
    const locked = Boolean(templateID);
    const capabilities = builderCapabilities(locked ? 'template-content' : 'freeform', lockedForm);
    const [template, setTemplate] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [types, setTypes] = useState([]);
    const [designs, setDesigns] = useState([]);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState('');
    const [variationChooser, setVariationChooser] = useState('');
    const [panel, setPanel] = useState('document');
    const sidebar = useBuilderSidebar(`${collectionSlug}:${documentID ?? 'new'}`);
    const { open: left, setOpen: setLeft, setMode: setLibraryMode } = sidebar;
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
    }, [setLeft]);
    const [viewport, setViewport] = useState('desktop');
    const setDestination = sidebar.insert;
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
    const sidebarNodes = contentSidebarNodes(nodes);
    const destination = sidebar.target ?? insertionTarget(sidebarNodes, selected);
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
    const headingNodes = useMemo(() => new Map(walkContent(resolveDocumentHeadings(nodes)).map((node) => [node.id, node])), [nodes]);
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
            ...(node.kind === 'tableOfContents' ? { props: headingNodes.get(node.id)?.props } : {}),
            anchor: headingNodes.get(node.id)?.anchor,
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
        if (InspectorGesture.active
            ? !InspectorGesture.changed
            : InspectorGesture.pending || !typing || now - history.current.last > 700)
            history.current.past.push(structuredClone(current));
        markInspectorGesture();
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
        if (variationsFor(kind).length > 1 && !styleOnlyKinds.has(kind))
            setVariationChooser(node.id);
        sidebar.inserted();
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
    const gear = (_jsxs(_Fragment, { children: [_jsxs("details", { open: true, children: [_jsx("summary", { children: "Template" }), _jsxs("label", { children: ["Template", _jsxs("select", { "aria-label": "Template", disabled: lockedForm || templateField.disabled, value: relationID(templateField.value), onChange: (event) => changeTemplate(event.target.value), children: [_jsx("option", { value: "", children: postType?.defaultTemplate ? 'Use Post Type default' : 'Built-in layout — freeform blocks' }), templates.filter(template => !postType || postType.templates?.some(id => relationID(id) === String(template.id))).map((template) => (_jsx("option", { value: template.id, children: template.name }, template.id))), templateID && !templates.some((template) => String(template.id) === templateID) && (_jsx("option", { value: templateID, children: "Current template (unavailable)" }))] })] }), renderFields((groups.Template ?? []).filter((name) => !internal.has(name)))] }), Object.entries(groups)
                .filter(([name]) => name !== 'Template' && name !== 'Content')
                .map(([name, names]) => {
                const visible = names.filter((name) => !internal.has(name));
                return visible.length ? (_jsxs("details", { open: true, children: [_jsx("summary", { children: name }), renderFields(visible)] }, name)) : null;
            })] }));
    const bindField = (node) => node.binding && !node.binding.path.startsWith('templateValues.') && !node.binding.path.startsWith('postTypeValues.') ? (_jsx(React.Fragment, { children: renderFields([node.binding.path]) }, node.id)) : (_jsxs(React.Fragment, { children: [node.binding?.helpText && _jsx("p", { children: node.binding.helpText }), _jsx(BoundValue, { node: node, document: document, lexicalSchemaPath: lexicalSchemaPath, disabled: lockedForm, onValues: (path, value) => {
                    if (path.startsWith('postTypeValues.')) {
                        typeValuesField.setValue({ ...typeValuesField.value, [path.slice('postTypeValues.'.length)]: value });
                        return;
                    }
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
            return node.binding ? (bindField(node)) : node.kind === 'designed' || node.fields?.length ? (_jsxs(_Fragment, { children: [_jsx(ContentBlock, { node: resolvedNode(node), viewport: viewport }), node.fields?.map(bindField)] })) : undefined;
        if (['heading', 'paragraph', 'quote', 'list'].includes(node.kind))
            return node.richText ? (_jsx(RenderLexical, { field: {
                    name: 'content',
                    type: 'richText',
                    label: node.label,
                    admin: { readOnly: lockedForm },
                }, path: `editorText.${node.id}`, schemaPath: lexicalSchemaPath, value: node.richText, setValue: (richText) => changeNode(node.id, { richText }, true) })) : (_jsx(InlineText, { node: node, disabled: lockedForm, onChange: (text) => changeNode(node.id, { text }, true) }));
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
    const tree = (items, parent = 'root', trailing = true) => (_jsxs(_Fragment, { children: [items.map((node) => (_jsxs(React.Fragment, { children: [!locked && (_jsx(Insertion, { parent: parent, before: node.id, disabled: lockedForm, onChoose: () => {
                            setDestination({ parent, before: node.id });
                            setLeft(true);
                            setLibraryMode('blocks');
                        } })), _jsxs(EditableNode, { node: node, selected: selected === node.id, onSelect: () => select(node.id), children: [!locked && !lockedForm && variationChooser === node.id && (_jsx(VariationPicker, { node: node, initial: true, onChange: (next) => changeNode(node.id, next), onDone: () => setVariationChooser('') })), _jsx(EditingSelection.Provider, { value: selected, children: _jsx(ContentBlock, { node: resolvedNode(node), viewport: viewport, document: document, body: editorBody(node), children: containerKinds.has(node.kind) &&
                                        (node.children?.length
                                            ? node.children.map((child, index) => (_jsx(React.Fragment, { children: tree([child], node.id, index === node.children.length - 1) }, child.id)))
                                            : tree([], node.id)) }) })] })] }, node.id))), !locked && trailing && (_jsx(Insertion, { parent: parent, empty: items.length === 0, disabled: lockedForm, onChoose: () => {
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
                if (event.key === 'Escape' && !right && window.matchMedia('(max-width: 1100px)').matches)
                    sidebar.close();
                if ((event.metaKey || event.ctrlKey) &&
                    event.key.toLowerCase() === 'z' &&
                    !event.target.closest('.editor-header__title')) {
                    event.preventDefault();
                    event.stopPropagation();
                    undo(event.shiftKey);
                }
            }, children: [_jsx(EditorHistory, { undo: () => undo(), redo: () => undo(true), canUndo: !lockedForm && Boolean(history.current.past.length), canRedo: !lockedForm && Boolean(history.current.future.length) }), _jsx(EditorHeaderPortal, { slot: "navigation", children: _jsx(SidebarControls, { state: sidebar, canInsert: capabilities.editStructure }) }), _jsx(EditorHeaderPortal, { slot: "preview", children: _jsxs("div", { className: "editor-header__buttons", children: [_jsx(EditorDevices, { value: viewport, onChange: setViewport }), _jsx(InspectorToggle, { open: right, change: (open) => {
                                    setRight(open);
                                    if (open && window.matchMedia('(max-width: 1100px)').matches)
                                        setLeft(false);
                                } })] }) }), _jsx(EditorHeaderPortal, { slot: "title", children: _jsx("div", { className: "editor-header__title", children: renderFields(['title']) }) }), _jsxs(BuilderPanels, { viewport: viewport, onViewportChange: setViewport, className: "content-workspace__layout", leftOpen: left, rightOpen: right, children: [_jsx("aside", { hidden: !left, className: "content-workspace__left", "aria-label": "Block library and hierarchy", children: _jsx(BuilderSidebar, { state: sidebar, adapter: {
                                    nodes: sidebarNodes,
                                    selected,
                                    canEdit: capabilities.editStructure,
                                    locked,
                                    items: [
                                        ...getContentLibrary().map((item) => ({ ...item, value: item.kind })),
                                        ...types
                                            .filter((type) => type.rendererKey === 'hero-board')
                                            .map((type) => ({
                                            kind: 'designed',
                                            value: String(type.id),
                                            label: type.name,
                                            category: 'Designed Blocks',
                                        })),
                                    ],
                                    onSelect: selectAndScroll,
                                    onInsert: (item, target) => add(item.kind, target.parent, target.before, types.find((type) => String(type.id) === item.value)),
                                    onMove: (id, target) => setNodes(moveContent(nodes, id, target.parent, target.before)),
                                    onDuplicate: (id) => {
                                        const node = walkContent(nodes).find((node) => node.id === id);
                                        const position = locateSidebar(sidebarNodes, id);
                                        if (node && position) {
                                            const copy = duplicateContent(node);
                                            setNodes(insertContent(nodes, copy, position.parent, position.siblings[position.index + 1]?.id));
                                            select(copy.id);
                                        }
                                    },
                                    onDelete: (id) => {
                                        setNodes(removeContent(nodes, id));
                                        setSelected('');
                                    },
                                } }) }), _jsxs("div", { className: "content-workspace__center", children: [error && _jsx("p", { role: "alert", children: error }), issues.length > 0 && (_jsx("div", { role: "alert", children: issues.map(([path, value]) => (_jsx("button", { type: "button", onClick: () => {
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
                                        }, children: String(value.errorMessage) }, path))) })), _jsx("div", { className: "content-workspace__viewport", "data-viewport": viewport, style: {
                                        maxWidth: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : undefined,
                                    }, children: locked && (!template || String(template.id) !== templateID) ? (_jsx("p", { children: "Loading template\u2026" })) : (tree(nodes)) })] }), right && (_jsxs("aside", { className: "content-workspace__right", "aria-label": "Inspector", children: [_jsx(InspectorTabs, { value: panel, onChange: setPanel, documentLabel: documentLabel }), panel === 'document' ? (_jsx("div", { className: "builder-document-settings", children: gear })) : !active ? (_jsx("p", { children: "Select a block on the canvas or in List view." })) : (_jsx(_Fragment, { children: locked ? (_jsxs(_Fragment, { children: [_jsxs("header", { className: "inspector-locked-heading", children: [_jsxs("strong", { children: [_jsx(BlockGlyph, { kind: active.kind }), ' ', active.label ?? getBlockDefinition(active.kind)?.label ?? active.kind] }), _jsx("p", { children: "Template structure and design are locked." })] }), active.binding
                                                ? bindField(active)
                                                : (active.fields?.map(bindField) ?? (_jsx("p", { children: "This element has no editable fields." })))] })) : (_jsx(_Fragment, { children: _jsx(BlockInspector, { listings: walkContent(nodes)
                                                .filter((node) => node.kind === 'postListing')
                                                .map((node) => ({ id: node.id, label: node.label ?? 'Listing' })), node: active, disabled: lockedForm, viewport: viewport, designs: designs, types: types, onChange: (patch) => changeNode(active.id, patch, true) }) })) }))] }))] })] }) }));
};
function Insertion({ empty = false, parent, before, disabled, onChoose, }) {
    const drop = useDroppable({
        id: `insert:${parent}:${before ?? 'end'}`,
        data: { containerID: parent, beforeID: before },
        disabled,
    });
    return (_jsx("div", { ref: drop.setNodeRef, className: "content-workspace__insert", "data-empty": empty, "data-over": drop.isOver, children: _jsx("button", { type: "button", disabled: disabled, "aria-label": `Insert block ${before ? 'before block' : 'at end'}`, onClick: onChoose, children: "+" }) }));
}
function EditableNode({ node, selected, onSelect, children, }) {
    return (_jsx("section", { id: `editor-${node.id}`, "data-builder-node": node.id, className: "content-workspace__node", "data-selected": selected, "aria-label": node.label ?? node.kind, onClick: (event) => {
            event.stopPropagation();
            onSelect();
        }, onFocus: (event) => {
            event.stopPropagation();
            onSelect();
        }, children: children }));
}
function MediaPicker({ value, onChange, many = false, disabled = false, label = 'Image', }) {
    const { config } = useConfig();
    return (_jsx(UploadInput, { api: config.routes.api, allowCreate: true, hasMany: many, isSortable: many, label: label, onChange: onChange, path: "editor-media", readOnly: disabled, relationTo: "media", serverURL: config.serverURL, showError: false, value: value }));
}
function BoundValue({ node, document, lexicalSchemaPath, disabled, onValues, }) {
    const binding = node.binding;
    const field = useField({
        path: binding.path,
        disableFormData: binding.path.startsWith('templateValues.') || binding.path.startsWith('postTypeValues.'),
    });
    const value = readPath(document, binding.path);
    const update = (value) => binding.path.startsWith('templateValues.') || binding.path.startsWith('postTypeValues.')
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
function BlockInspector({ listings, node, disabled, viewport, designs, types, onChange, }) {
    return (_jsx(UnifiedBlockInspector, { listings: listings, renderDocumentPicker: (collection, label, value, change) => (_jsx(DocumentPicker, { collection: collection, label: label, value: value, change: change })), node: node, disabled: disabled, viewport: viewport, onChange: onChange, renderBackgroundMedia: (value, change) => (_jsx(BackgroundMediaPicker, { value: value, change: change })), children: _jsxs("details", { open: true, children: [_jsx("summary", { children: "Settings" }), _jsxs("label", { children: ["Block label", _jsx("input", { value: node.label ?? '', onChange: (event) => onChange({ label: event.target.value }) })] }), node.kind === 'heading' && (_jsxs("label", { children: ["Heading level", _jsx("select", { value: node.level ?? 2, onChange: (event) => onChange({ level: Number(event.target.value) }), children: [1, 2, 3, 4, 5, 6].map((level) => (_jsxs("option", { value: level, children: ["H", level] }, level))) })] })), node.kind === 'list' && (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!node.ordered, onChange: (event) => onChange({ ordered: event.target.checked }) }), "Numbered list"] })), ['button', 'video'].includes(node.kind) && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["URL", _jsx("input", { value: node.url ?? '', onChange: (event) => onChange({ url: event.target.value }) })] }), _jsxs("label", { children: ["Text", _jsx("input", { value: node.text ?? '', onChange: (event) => onChange({ text: event.target.value }) })] })] })), ['image', 'gallery'].includes(node.kind) && (_jsx(MediaPicker, { value: node.media, onChange: (media) => onChange({ media }), many: node.kind === 'gallery', disabled: disabled })), node.kind === 'image' && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Alternative text", _jsx("input", { value: node.alt ?? '', onChange: (event) => onChange({ alt: event.target.value }) })] }), _jsxs("label", { children: ["Caption", _jsx("input", { value: node.text ?? '', onChange: (event) => onChange({ text: event.target.value }) })] })] })), node.kind === 'columns' && (_jsx("button", { type: "button", onClick: () => onChange({ children: [...(node.children ?? []), createContentNode('column')] }), children: "Add column" })), node.kind === 'designed' && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Design", _jsxs("select", { value: node.blockDesign ?? '', onChange: (event) => onChange({
                                        blockDesign: designs.find((design) => String(design.id) === event.target.value)
                                            ?.id,
                                    }), children: [_jsx("option", { value: "", children: "Choose\u2026" }), designs
                                            .filter((design) => relationID(design.blockType) === String(node.blockType))
                                            .map((design) => (_jsx("option", { value: design.id, children: design.name }, design.id)))] })] }), _jsx(DesignedFields, { fields: types.find((type) => String(type.id) === String(node.blockType))?.fields ?? [], values: node.values ?? {}, disabled: disabled, onChange: (values) => onChange({ values }) })] }))] }) }));
}
function DesignedFields({ fields, values, disabled, onChange, }) {
    return (_jsx(_Fragment, { children: fields.map((field) => field.kind === 'group' ? (_jsxs("fieldset", { children: [_jsx("legend", { children: field.label }), _jsx(DesignedFields, { fields: field.children ?? [], values: values[field.key] ?? {}, disabled: disabled, onChange: (value) => onChange({ ...values, [field.key]: value }) })] }, field.key)) : field.kind === 'media' ? (_jsx(MediaPicker, { label: field.label, disabled: disabled, value: values[field.key], onChange: (value) => onChange({ ...values, [field.key]: value }) }, field.key)) : (_jsxs("label", { children: [field.label, _jsx("input", { disabled: disabled, value: String(values[field.key] ?? ''), onChange: (event) => onChange({ ...values, [field.key]: event.target.value }) })] }, field.key))) }));
}
