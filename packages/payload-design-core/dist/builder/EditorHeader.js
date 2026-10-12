'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './InspectorControls.js';
import './editor-header.css';
const drawer = (element) => element.closest('.doc-drawer, [role="dialog"]');
function useDocumentKey() {
    const { collectionSlug, globalSlug, id } = useDocumentInfo();
    return `${collectionSlug ?? globalSlug}:${id ?? 'new'}`;
}
/** Only application-owned slots are portal targets; Payload's DOM is never moved. */
function HeaderSlot({ slot }) {
    return (_jsx("span", { className: `editor-header__slot editor-header__slot--${slot}`, "data-editor-slot": slot, "data-editor-document": useDocumentKey() }));
}
export function EditorTitleSlot() {
    const { id } = useDocumentInfo();
    const ref = useRef(null);
    const [inDrawer, setInDrawer] = useState(false);
    useEffect(() => {
        setInDrawer(Boolean(ref.current && drawer(ref.current)));
    }, []);
    return (_jsxs("span", { ref: ref, className: "editor-header__title-host", children: [_jsx(HeaderSlot, { slot: "title" }), (inDrawer || !id) && _jsx(HeaderSlot, { slot: "history" })] }));
}
export function EditorHistorySlot() {
    return (_jsx("li", { className: "editor-header__history-host", children: _jsx(HeaderSlot, { slot: "history" }) }));
}
export function EditorPreviewSlot() {
    return (_jsxs(_Fragment, { children: [_jsx(HeaderSlot, { slot: "navigation" }), _jsx(HeaderSlot, { slot: "preview" }), _jsx(HeaderSlot, { slot: "actions" })] }));
}
export function EditorHeaderPortal({ slot, children, waitForTarget = false, }) {
    const key = useDocumentKey();
    const marker = useRef(null);
    const [target, setTarget] = useState(null);
    useEffect(() => {
        const locate = () => {
            const owner = marker.current;
            if (!owner)
                return;
            const next = Array.from(document.querySelectorAll('[data-editor-slot]')).find((element) => element.getAttribute('data-editor-slot') === slot &&
                element.getAttribute('data-editor-document') === key &&
                drawer(element) === drawer(owner)) ?? null;
            setTarget((previous) => (previous === next ? previous : next));
        };
        locate();
        const observer = new MutationObserver(locate);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [key, slot]);
    return (_jsxs(_Fragment, { children: [_jsx("span", { ref: marker, hidden: true }), target ? (createPortal(children, target)) : waitForTarget ? null : (_jsx("div", { className: `editor-header__fallback editor-header__fallback--${slot}`, children: children }))] }));
}
export function EditorHistory({ undo, redo, canUndo, canRedo, }) {
    return (_jsx(EditorHeaderPortal, { slot: "history", children: _jsxs("div", { className: "editor-header__buttons", role: "group", "aria-label": "Edit history", children: [_jsx(IconButton, { label: "Undo", icon: "undo", onClick: undo, disabled: !canUndo }), _jsx(IconButton, { label: "Redo", icon: "redo", onClick: redo, disabled: !canRedo })] }) }));
}
export function EditorDevices({ value, onChange, }) {
    return (_jsx("div", { className: "editor-header__buttons", role: "toolbar", "aria-label": "Responsive preview", children: ['desktop', 'tablet', 'mobile'].map((device) => (_jsx(IconButton, { label: device === 'mobile' ? 'Phone' : device[0].toUpperCase() + device.slice(1), icon: device, pressed: value === device, onClick: () => onChange(device) }, device))) }));
}
/** Template names use the same existing form path as their hidden schema field. */
export function EditorName() {
    const { value, setValue, showError, errorMessage, disabled: fieldDisabled } = useField({ path: 'name' });
    const { disabled } = useForm();
    const { id, docPermissions, hasSavePermission } = useDocumentInfo();
    const fields = docPermissions?.fields;
    const permission = fields && typeof fields === 'object' ? fields.name : undefined;
    const readOnly = fieldDisabled ||
        disabled ||
        hasSavePermission === false ||
        (fields !== undefined &&
            fields !== true &&
            permission !== true &&
            !permission?.[id ? 'update' : 'create']);
    return (_jsx(EditorHeaderPortal, { slot: "title", children: _jsxs("div", { className: "editor-header__title", children: [_jsx("input", { id: "field-name", name: "name", "aria-label": "Name", placeholder: "Add title", value: value ?? '', readOnly: readOnly, "aria-invalid": showError || undefined, "aria-required": "true", onChange: (event) => setValue(event.target.value) }), showError && _jsx("p", { role: "alert", children: errorMessage })] }) }));
}
