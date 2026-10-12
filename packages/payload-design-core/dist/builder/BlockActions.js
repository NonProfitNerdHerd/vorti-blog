'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { BlockGlyph } from '../blocks/BlockGlyph.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { flattenSidebar, locateSidebar } from './sidebar-model.js';
import { InspectorIcon } from './InspectorControls.js';
import './block-actions.css';
export function BlockActionMenu({ node, adapter, state, }) {
    const [open, setOpen] = useState(false);
    const [host, setHost] = useState(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const trigger = useRef(null);
    const menu = useRef(null);
    const location = locateSidebar(adapter.nodes, node.id);
    const close = () => {
        setOpen(false);
        trigger.current?.focus();
    };
    useLayoutEffect(() => {
        if (!open)
            return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect)
                return;
            setPosition({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - (menu.current?.offsetWidth ?? 240) - 8)),
                top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - (menu.current?.offsetHeight ?? 300) - 8)),
            });
        };
        place();
        menu.current?.querySelector('button:not(:disabled)')?.focus();
        const outside = (event) => {
            if (!menu.current?.contains(event.target) &&
                !trigger.current?.contains(event.target))
                close();
        };
        const escape = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', escape, true);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [open]);
    if (!location || !adapter.canEdit || adapter.locked || node.ownerID || node.immovable)
        return null;
    const run = (action) => {
        close();
        action();
    };
    const move = (before) => run(() => adapter.onMove(node.id, { parent: location.parent, before }));
    const excluded = new Set(flattenSidebar([node]).map((child) => child.id));
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", ref: trigger, className: "block-actions__trigger", "aria-label": `Actions for ${node.label}`, title: `Actions for ${node.label}`, "aria-haspopup": "dialog", "aria-expanded": open, onClick: (event) => {
                    setHost(event.currentTarget.closest('.doc-drawer, [role="dialog"]') ?? document.body);
                    setOpen(!open);
                }, children: _jsx(InspectorIcon, { name: "more" }) }), open &&
                host &&
                createPortal(_jsxs("div", { ref: menu, className: "block-actions__menu", role: "dialog", "aria-label": `${node.label} actions`, style: position, onClick: (event) => event.stopPropagation(), onKeyDown: (event) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key) ||
                            event.target instanceof HTMLSelectElement)
                            return;
                        const items = Array.from(menu.current?.querySelectorAll('button,select') ?? []);
                        const enabled = items.filter((item) => !item.disabled);
                        const index = enabled.indexOf(document.activeElement);
                        const next = event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                                ? enabled.length - 1
                                : (index +
                                    (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
                                        ? -1
                                        : 1) +
                                    enabled.length) %
                                    enabled.length;
                        event.preventDefault();
                        enabled[next]?.focus();
                    }, children: [_jsx("button", { type: "button", disabled: location.index === 0, onClick: () => move(location.siblings[location.index - 1]?.id), children: "Move up" }), _jsx("button", { type: "button", disabled: location.index === location.siblings.length - 1, onClick: () => move(location.siblings[location.index + 2]?.id), children: "Move down" }), adapter.onDuplicate && (_jsx("button", { type: "button", onClick: () => run(() => adapter.onDuplicate?.(node.id)), children: "Duplicate" })), node.kind !== 'column' && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => run(() => state.insert({ parent: location.parent, before: node.id })), children: "Add before" }), _jsx("button", { type: "button", onClick: () => run(() => state.insert({
                                        parent: location.parent,
                                        before: location.siblings[location.index + 1]?.id,
                                    })), children: "Add after" }), _jsxs("label", { children: ["Move to\u2026", _jsxs("select", { "aria-label": `Move ${node.label} into`, value: "", onChange: (event) => {
                                                if (event.target.value)
                                                    run(() => adapter.onMove(node.id, { parent: event.target.value }));
                                            }, children: [_jsx("option", { value: "", children: "Choose destination" }), _jsx("option", { value: "root", children: "Document top level" }), flattenSidebar(adapter.nodes)
                                                    .filter((candidate) => candidate.container && !candidate.ownerID && !excluded.has(candidate.id))
                                                    .map((candidate) => (_jsx("option", { value: candidate.id, children: candidate.label }, candidate.id)))] })] })] })), adapter.onDelete && (_jsx("button", { type: "button", className: "block-actions__delete", onClick: () => run(() => adapter.onDelete?.(node.id)), children: "Delete" }))] }), host)] }));
}
/** Lives with the adapter, including when the hierarchy panel is closed. */
export function SelectedBlockToolbar({ adapter, state, scope, }) {
    const toolbar = useRef(null);
    const [anchor, setAnchor] = useState(null);
    const [position, setPosition] = useState({ left: 0, top: 0, visible: false });
    const node = flattenSidebar(adapter.nodes).find((item) => item.id === adapter.selected);
    useEffect(() => {
        const root = scope.current?.closest('.builder-frame');
        const find = () => setAnchor(Array.from(root?.querySelectorAll('[data-builder-node]') ?? []).find((element) => element.dataset.builderNode === adapter.selected) ?? null);
        find();
        const observer = new MutationObserver(find);
        if (root)
            observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [adapter.selected, scope]);
    useLayoutEffect(() => {
        if (!anchor)
            return;
        const place = () => {
            const rect = anchor.getBoundingClientRect();
            const bounds = anchor
                .closest('.content-workspace__center, .template-editor__canvas')
                ?.getBoundingClientRect();
            const width = toolbar.current?.offsetWidth ?? 148;
            const height = toolbar.current?.offsetHeight ?? 36;
            const top = Math.max(8, bounds?.top ?? 0);
            const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
            setPosition({
                left: Math.max(bounds?.left ?? 8, Math.min(rect.left, (bounds?.right ?? window.innerWidth) - width)),
                top: Math.max(top, Math.min(rect.top - height - 4, bottom - height)),
                visible: rect.bottom > top && rect.top < bottom,
            });
        };
        place();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
        observer?.observe(anchor);
        const canvas = anchor.closest('.content-workspace__center, .template-editor__canvas');
        if (canvas)
            observer?.observe(canvas);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            observer?.disconnect();
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [anchor]);
    if (!node || !anchor || !adapter.canEdit || adapter.locked || node.ownerID || node.immovable)
        return null;
    const location = locateSidebar(adapter.nodes, node.id);
    return createPortal(_jsxs("div", { ref: toolbar, className: "block-actions__toolbar", role: "toolbar", "aria-label": `${node.label} block controls`, style: {
            left: position.left,
            top: position.top,
            visibility: position.visible ? 'visible' : 'hidden',
        }, children: [_jsx("span", { title: node.label, "aria-label": node.label, children: _jsx(BlockGlyph, { kind: node.kind }) }), _jsx("button", { type: "button", title: "Move up", "aria-label": `Move ${node.label} up`, disabled: location.index === 0, onClick: () => adapter.onMove(node.id, {
                    parent: location.parent,
                    before: location.siblings[location.index - 1]?.id,
                }), children: _jsx(InspectorIcon, { name: "up" }) }), _jsx("button", { type: "button", title: "Move down", "aria-label": `Move ${node.label} down`, disabled: location.index === location.siblings.length - 1, onClick: () => adapter.onMove(node.id, {
                    parent: location.parent,
                    before: location.siblings[location.index + 2]?.id,
                }), children: _jsx(InspectorIcon, { name: "down" }) }), _jsx(BlockActionMenu, { node: node, adapter: adapter, state: state }, node.id)] }), anchor.closest('.doc-drawer, [role="dialog"]') ?? document.body);
}
