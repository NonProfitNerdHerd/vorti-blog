'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit supplies callback refs; opener is only read in event handlers. */
import { getBlockDefinition } from '../blocks/registry.js';
import { useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { flattenSidebar, insertionTarget, locateSidebar, outlineSummary, } from './sidebar-model.js';
import './builder-sidebar.css';
import { BlockActionMenu, SelectedBlockToolbar } from './BlockActions.js';
export function useBuilderSidebar(identity) {
    const [open, setOpen] = useState(true);
    const [mode, setMode] = useState('list');
    const [target, setTarget] = useState();
    const opener = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const escape = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented)
                return;
            setOpen(false);
            setTarget(undefined);
            opener.current?.focus();
        };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    }, [open]);
    useEffect(() => {
        // Reset UI state on document/region changes; these values are never persisted.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTarget(undefined);
        setMode('list');
        const media = window.matchMedia?.('(max-width: 1100px)');
        setOpen(!media?.matches);
        const change = () => {
            if (media?.matches)
                setOpen(false);
        };
        media?.addEventListener('change', change);
        return () => media?.removeEventListener('change', change);
    }, [identity]);
    const close = () => {
        setOpen(false);
        setTarget(undefined);
        opener.current?.focus();
    };
    const insert = (destination) => {
        setTarget(destination);
        setMode('blocks');
        setOpen(true);
        if (window.document.activeElement instanceof HTMLButtonElement)
            opener.current = window.document.activeElement;
    };
    const inserted = () => {
        setTarget(undefined);
        setMode('list');
        if (window.matchMedia?.('(max-width: 1100px)').matches)
            close();
    };
    return {
        open,
        setOpen,
        mode,
        setMode,
        target,
        rememberOpener: (button) => {
            opener.current = button;
        },
        close,
        insert,
        inserted,
    };
}
export function SidebarControls({ state, canInsert = true, }) {
    return (_jsxs("span", { className: "builder-sidebar-controls", children: [canInsert && (_jsx("button", { type: "button", "aria-label": "Add block", title: "Add block", "aria-expanded": state.open && state.mode === 'blocks', onClick: (event) => {
                    state.insert();
                    state.rememberOpener(event.currentTarget);
                }, children: _jsx("span", { "aria-hidden": "true", children: "+" }) })), _jsx("button", { type: "button", "aria-label": "List View", title: "List View", "aria-expanded": state.open && state.mode !== 'blocks', onClick: (event) => {
                    state.rememberOpener(event.currentTarget);
                    state.setMode('list');
                    state.setOpen(!(state.open && state.mode !== 'blocks'));
                }, children: _jsx("span", { "aria-hidden": "true", children: "\u2637" }) })] }));
}
function icon(kind) {
    const registered = getBlockDefinition(kind);
    if (registered)
        return registered.icon;
    if (/heading|shortText/i.test(kind))
        return 'H';
    if (/image|gallery|logo|images/i.test(kind))
        return '▧';
    if (/column|row|group|container|stack/i.test(kind))
        return '▤';
    if (/list/i.test(kind))
        return '☷';
    if (/quote/i.test(kind))
        return '❞';
    if (/button|link|navigation/i.test(kind))
        return '↗';
    if (/text|paragraph/i.test(kind))
        return '¶';
    return '◇';
}
export function BuilderSidebar({ state, adapter, }) {
    const [query, setQuery] = useState('');
    const panel = useRef(null);
    const { nodes, selected, canEdit, locked } = adapter;
    const summary = outlineSummary(nodes);
    useEffect(() => {
        if (state.open && state.mode === 'blocks')
            panel.current?.querySelector('input')?.focus();
    }, [state.open, state.mode]);
    const choose = (node) => {
        const id = node.ownerID ?? node.id;
        adapter.onSelect(id);
        const root = panel.current?.closest('.content-workspace, .template-editor');
        requestAnimationFrame(() => {
            const element = Array.from(root?.querySelectorAll('[data-builder-node]') ?? []).find((element) => element.dataset.builderNode === id);
            element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        });
        if (window.matchMedia?.('(max-width: 1100px)').matches)
            state.close();
    };
    const visibleItems = adapter.items.filter((item) => `${item.label} ${item.category} ${item.keywords?.join(' ') ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()));
    return (_jsxs("div", { className: "builder-sidebar", ref: panel, onKeyDown: (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                state.close();
            }
        }, children: [_jsx(SelectedBlockToolbar, { adapter: adapter, state: state, scope: panel }), _jsxs("div", { className: "builder-sidebar__header", children: [state.mode === 'blocks' && canEdit ? (_jsx("strong", { children: "Blocks" })) : (_jsx("div", { role: "tablist", "aria-label": "Block navigation", children: ['list', 'outline'].map((mode) => (_jsx("button", { type: "button", role: "tab", "aria-selected": state.mode === mode, onClick: () => state.setMode(mode), children: mode === 'list' ? 'List View' : 'Outline' }, mode))) })), _jsx("button", { type: "button", "aria-label": "Close left panel", onClick: state.close, children: "\u00D7" })] }), state.mode === 'blocks' && canEdit ? (_jsxs("div", { className: "builder-sidebar__inserter", children: [_jsx("input", { "aria-label": "Search blocks", placeholder: "Search blocks", value: query, onChange: (event) => setQuery(event.target.value) }), [...new Set(visibleItems.map((item) => item.category))].map((category) => (_jsxs("section", { children: [_jsx("h3", { children: category }), _jsx("div", { className: "builder-sidebar__grid", children: visibleItems
                                    .filter((item) => item.category === category)
                                    .map((item) => (_jsx(Tile, { item: item, onClick: () => adapter.onInsert(item, state.target ?? insertionTarget(nodes, selected)) }, `${item.kind}:${item.value}`))) })] }, category))), !visibleItems.length && _jsx("p", { children: "No matching blocks." })] })) : state.mode === 'outline' ? (_jsxs("div", { className: "builder-sidebar__outline", role: "tabpanel", "aria-label": "Outline", children: [_jsxs("p", { children: [summary.words, " words \u00B7 ", summary.minutes, " min read"] }), summary.headings.length ? (summary.headings.map((node) => (_jsxs("button", { type: "button", style: { paddingLeft: `${Math.max(0, (node.heading ?? 1) - 1) * 12 + 8}px` }, onClick: () => choose(node), children: [_jsxs("small", { children: ["H", node.heading] }), " ", node.text] }, node.id)))) : (_jsx("p", { children: "No headings yet. Add a heading to create an outline." }))] })) : (_jsxs("div", { role: "tabpanel", "aria-label": "List View", children: [!nodes.length && (_jsxs("p", { className: "builder-sidebar__empty", children: ["No blocks yet.", canEdit && ' Use + to add your first block.'] })), _jsx("ul", { className: "builder-sidebar__tree", "aria-label": "Block hierarchy", children: nodes.map((node) => (_jsx(Row, { node: node, adapter: adapter, choose: choose, state: state }, node.id))) }), canEdit && !locked && (_jsx(TreeDrop, { target: { parent: 'root' }, label: "Move to document end" }))] }))] }));
}
function Tile({ item, onClick }) {
    const drag = useDraggable({
        id: `sidebar-library:${item.kind}:${item.value}`,
        data: { library: item },
    });
    return (_jsxs("button", { type: "button", ref: drag.setNodeRef, ...drag.attributes, ...drag.listeners, className: "builder-sidebar__tile", onClick: onClick, "aria-label": item.label, children: [_jsx("span", { "aria-hidden": "true", children: icon(item.value || item.kind) }), _jsx("span", { children: item.label })] }));
}
function TreeDrop({ target, label }) {
    const drop = useDroppable({
        id: `sidebar-drop:${target.parent}:${target.before ?? 'end'}`,
        data: { containerID: target.parent, beforeID: target.before },
    });
    return (_jsx("div", { ref: drop.setNodeRef, className: "builder-sidebar__drop", "data-over": drop.isOver, "aria-label": label, children: label }));
}
function Row({ node, adapter, choose, state, }) {
    const { nodes, selected, canEdit, locked } = adapter;
    const location = locateSidebar(nodes, node.id);
    const [collapsed, setCollapsed] = useState(false);
    const selectedWithin = flattenSidebar(node.children ?? []).some((child) => child.id === selected);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Canvas selection reveals the selected block's ancestors.
        if (selectedWithin)
            setCollapsed(false);
    }, [selected, selectedWithin]);
    const editable = canEdit && !locked && !node.ownerID && !node.immovable;
    const drag = useDraggable({
        id: `sidebar-node:${node.id}`,
        data: { nodeID: node.id },
        disabled: !editable,
    });
    const hasChildren = Boolean(node.children?.length);
    const selectRef = useRef(null);
    useEffect(() => {
        if (selected === node.id)
            selectRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [selected, node.id]);
    return (_jsxs("li", { children: [editable && (_jsx(TreeDrop, { target: { parent: location.parent, before: node.id }, label: `Insert before ${node.label}` })), _jsxs("div", { className: "builder-sidebar__row", "data-selected": selected === node.id, children: [hasChildren ? (_jsx("button", { type: "button", "aria-label": `${collapsed ? 'Expand' : 'Collapse'} ${node.label}`, "aria-expanded": !collapsed, onClick: () => setCollapsed(!collapsed), children: collapsed ? '›' : '⌄' })) : (_jsx("span", { className: "builder-sidebar__indent" })), _jsxs("button", { type: "button", className: "builder-sidebar__select", ref: (element) => {
                            selectRef.current = element;
                            drag.setNodeRef(element);
                        }, ...(editable ? drag.attributes : {}), ...(editable ? drag.listeners : {}), "aria-current": selected === node.id ? 'true' : undefined, onClick: () => {
                            if (!drag.isDragging)
                                choose(node);
                        }, title: node.label, children: [_jsx("span", { "aria-hidden": "true", children: icon(node.kind) }), _jsx("span", { children: node.label }), locked && _jsx("span", { "aria-label": "Locked", children: "\u25A3" })] }), editable && _jsx(BlockActionMenu, { node: node, adapter: adapter, state: state })] }), hasChildren && !collapsed && (_jsx("ul", { children: node.children.map((child) => (_jsx(Row, { node: child, adapter: adapter, choose: choose, state: state }, child.id))) })), node.container && canEdit && !locked && !node.ownerID && (_jsx(TreeDrop, { target: { parent: node.id }, label: `Insert into ${node.label}` }))] }));
}
