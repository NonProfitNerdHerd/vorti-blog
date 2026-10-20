'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDocumentDrawer } from '@payloadcms/ui';
import { Plus } from 'lucide-react';
import { EditorDialog } from '../builder/EditorDialog.js';
/** The drawer mounts the existing template edit view, including TemplateBuilder. */
export function PostTemplateChooser({ templates, onChoose, onCancel, onCreated, error, loading, onRetry }) {
    const [selection, setSelection] = useState('');
    const [search, setSearch] = useState('');
    const [mounted, setMounted] = useState(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals must wait for the client document after hydration.
    useEffect(() => setMounted(true), []);
    const [TemplateDrawer, , { openDrawer, closeDrawer, isDrawerOpen }] = useDocumentDrawer({ collectionSlug: 'design-templates' });
    const selected = templates.find(template => String(template.id) === selection);
    if (!mounted)
        return null;
    // Keep chooser controls outside the native Post form: Enter in a search or
    // selector must never submit a Post before the explicit Create Post action.
    return createPortal(_jsxs(_Fragment, { children: [_jsx(EditorDialog, { open: !isDrawerOpen, title: "Select a template", onClose: onCancel, children: _jsxs("div", { className: "post-template-chooser", children: [_jsx("p", { children: "Choose a starting point for your Post. Your changes will belong to this Post." }), loading && _jsx("p", { role: "status", children: "Loading templates\u2026" }), error && _jsxs("p", { role: "alert", children: [error, " ", _jsx("button", { type: "button", onClick: onRetry, children: "Retry" })] }), templates.length > 10 && _jsxs("label", { children: ["Search templates", _jsx("input", { type: "search", value: search, onChange: event => setSearch(event.target.value) })] }), _jsxs("div", { className: "post-template-chooser__select", children: [_jsxs("label", { children: ["Template", _jsxs("select", { value: selection, onChange: event => setSelection(event.target.value), children: [_jsx("option", { value: "", disabled: true, children: "Select a template\u2026" }), _jsx("option", { value: "blank", children: "Blank" }), templates.filter(template => String(template.id) === selection || template.name.toLowerCase().includes(search.toLowerCase())).map(template => _jsx("option", { value: template.id, children: template.name }, template.id))] })] }), _jsx("button", { type: "button", "aria-label": "Create a Template", title: "Create a Template", onClick: openDrawer, children: _jsx(Plus, { size: 20 }) })] }), _jsx("p", { className: "post-template-chooser__description", children: selection === 'blank' ? 'Start with an empty block-based editor. Add and arrange your own blocks.' : selected?.description || (selected ? 'Start with this template’s layout and fields.' : 'Select a template or Blank to continue.') }), _jsxs("div", { className: "post-template-chooser__actions", children: [_jsx("button", { type: "button", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "post-template-chooser__primary", disabled: !selection, onClick: () => onChoose(selection), children: "Create Post" })] })] }) }), _jsx(TemplateDrawer, { initialData: { allowedCollections: ['posts'] }, redirectAfterCreate: false, onSave: ({ doc }) => {
                    const template = doc;
                    onCreated(template);
                    setSelection(String(template.id));
                    closeDrawer();
                } })] }), document.body);
}
