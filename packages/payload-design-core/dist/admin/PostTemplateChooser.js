'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, useConfig, useDocumentDrawer } from '@payloadcms/ui';
import { EditorDialog } from '../builder/EditorDialog.js';
/** A schematic preview of the template layout, with no public-content requests. */
function TemplateThumbnail({ template }) {
    const rows = Math.min(4, Math.max(1, template?.layout?.length || template?.sections?.length || 1));
    return (_jsxs("svg", { role: "img", "aria-label": template ? `${template.name} layout preview` : 'Blank editor preview', viewBox: "0 0 280 140", children: [_jsx("rect", { width: "280", height: "140", fill: "var(--theme-elevation-100)" }), _jsx("rect", { x: "35", y: "15", width: "210", height: "110", rx: "5", fill: "var(--theme-bg)" }), _jsx("rect", { x: "49", y: "27", width: "105", height: "8", rx: "3", fill: "#7064e8" }), template ? (Array.from({ length: rows }, (_, index) => (_jsxs("g", { transform: `translate(49 ${45 + index * (65 / rows)})`, children: [_jsx("rect", { width: index % 2 ? 130 : 182, height: Math.min(18, 48 / rows), rx: "3", fill: "var(--theme-elevation-200)" }), _jsx("rect", { x: "151", width: "31", height: Math.min(18, 48 / rows), rx: "3", fill: "#afa8f4" })] }, index)))) : (_jsx("path", { d: "M130 70h20m-10-10v20", stroke: "#aaa", strokeWidth: "2" }))] }));
}
export function PostTemplateChooser({ templates, onChoose, onCancel, onCreated, error, loading, onRetry, }) {
    const { config: { routes: { api }, }, } = useConfig();
    const { permissions } = useAuth();
    const canCreate = permissions?.collections?.['design-templates']?.create === true;
    const [selection, setSelection] = useState('');
    const [search, setSearch] = useState('');
    const [mounted, setMounted] = useState(false);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState('');
    const [saving, setSaving] = useState(false);
    const [templateID, setTemplateID] = useState();
    const [pendingOpen, setPendingOpen] = useState(false);
    const [counts, setCounts] = useState({});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals require the hydrated client document.
    useEffect(() => setMounted(true), []);
    const [TemplateDrawer, , { openDrawer, closeDrawer, isDrawerOpen }] = useDocumentDrawer({
        collectionSlug: 'design-templates',
        id: templateID,
    });
    useEffect(() => {
        if (pendingOpen && templateID != null) {
            openDrawer();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Open the native drawer only after its saved document ID reaches the hook.
            setPendingOpen(false);
        }
    }, [pendingOpen, templateID, openDrawer]);
    useEffect(() => {
        const controller = new AbortController();
        const pending = [...templates];
        async function worker() {
            while (pending.length && !controller.signal.aborted) {
                const template = pending.shift();
                try {
                    const response = await fetch(`${api}/posts/count?where[designTemplate][equals]=${encodeURIComponent(template.id)}`, { credentials: 'include', signal: controller.signal });
                    if (response.ok) {
                        const result = (await response.json());
                        setCounts((current) => ({ ...current, [template.id]: result.totalDocs }));
                    }
                }
                catch {
                    /* Usage ranking is optional; keep templates available if counts fail. */
                }
            }
        }
        void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
        return () => controller.abort();
    }, [templates, api]);
    async function createTemplate() {
        if (!name.trim() || saving)
            return;
        setSaving(true);
        setNameError('');
        try {
            const query = new URLSearchParams({
                'where[name][like]': name.trim(),
                limit: '100',
                depth: '0',
            });
            const existing = await fetch(`${api}/design-templates?${query}`, { credentials: 'include' });
            if (!existing.ok)
                throw new Error('Unable to check template names. Please retry.');
            const matches = (await existing.json());
            if (matches.docs.some((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase()))
                throw new Error('A template with this name already exists. Choose another name.');
            const response = await fetch(`${api}/design-templates`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    allowedCollections: ['posts'],
                    status: 'draft',
                    _status: 'draft',
                    sections: [],
                    layout: [],
                }),
            });
            const result = (await response.json());
            if (!response.ok)
                throw new Error(result.errors?.[0]?.message || 'Unable to create template. Please retry.');
            setTemplateID(result.doc.id);
            setNaming(false);
            setPendingOpen(true);
        }
        catch (failure) {
            setNameError(failure instanceof Error ? failure.message : 'Unable to create template.');
        }
        finally {
            setSaving(false);
        }
    }
    if (!mounted)
        return null;
    const ranked = [...templates].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name));
    return createPortal(_jsxs(_Fragment, { children: [_jsx(EditorDialog, { open: !isDrawerOpen && !pendingOpen && !naming, title: "Create a Post \u00B7 Choose a template", onClose: onCancel, children: _jsxs("div", { className: "post-template-chooser", children: [_jsx("p", { children: "Choose a starting point for your Post. Your changes will belong to this Post." }), loading && _jsx("p", { role: "status", children: "Loading templates\u2026" }), error && (_jsxs("p", { role: "alert", children: [error, ' ', _jsx("button", { type: "button", onClick: onRetry, children: "Retry" })] })), templates.length > 6 && (_jsxs("label", { children: ["Search templates", _jsx("input", { type: "search", value: search, onChange: (event) => setSearch(event.target.value) })] })), _jsxs("div", { className: "post-template-chooser__tiles", role: "group", "aria-label": "Post templates", children: [ranked
                                    .filter((template) => template.name.toLowerCase().includes(search.toLowerCase()))
                                    .map((template) => (_jsxs("button", { type: "button", className: "post-template-tile", "aria-pressed": selection === String(template.id), onClick: () => setSelection(String(template.id)), children: [_jsx(TemplateThumbnail, { template: template }), _jsx("strong", { children: template.name }), _jsx("span", { children: template.description || 'Start with this template’s layout and fields.' }), _jsx("small", { children: counts[template.id] ? `${counts[template.id]} posts` : 'Reusable template' })] }, template.id))), !search && (_jsxs("button", { type: "button", className: "post-template-tile", "aria-pressed": selection === 'blank', onClick: () => setSelection('blank'), children: [_jsx(TemplateThumbnail, {}), _jsx("strong", { children: "Blank" }), _jsx("span", { children: "Start with an empty block-based editor. Add and arrange your own blocks." })] })), search &&
                                    !ranked.some((template) => template.name.toLowerCase().includes(search.toLowerCase())) && _jsx("p", { children: "No matching templates." })] }), _jsxs("div", { className: "post-template-chooser__footer", children: [canCreate && (_jsx("button", { type: "button", onClick: () => {
                                        setNaming(true);
                                        setNameError('');
                                    }, children: "Create Template" })), _jsxs("div", { className: "post-template-chooser__actions", children: [_jsx("button", { type: "button", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "post-template-chooser__primary", disabled: !selection, onClick: () => onChoose(selection), children: "Create Post" })] })] })] }) }), _jsx(EditorDialog, { open: naming, title: "Create a Template", onClose: () => {
                    if (!saving)
                        setNaming(false);
                }, children: _jsxs("div", { className: "post-template-chooser", children: [_jsx("p", { children: "Create a reusable template, not a post. Name it first, then build its layout. It becomes available for new posts after publishing." }), _jsxs("label", { children: ["Template name", _jsx("input", { autoFocus: true, value: name, maxLength: 200, disabled: saving, onChange: (event) => setName(event.target.value), onKeyDown: (event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            void createTemplate();
                                        }
                                    } })] }), nameError && _jsx("p", { role: "alert", children: nameError }), _jsxs("div", { className: "post-template-chooser__actions", children: [_jsx("button", { type: "button", disabled: saving, onClick: () => setNaming(false), children: "Cancel" }), _jsx("button", { type: "button", className: "post-template-chooser__primary", disabled: saving || !name.trim(), onClick: () => void createTemplate(), children: saving ? 'Creating…' : 'Save name and build template' })] })] }) }), _jsx(TemplateDrawer, { redirectAfterCreate: false, onSave: ({ doc }) => {
                    const template = doc;
                    if (template.status === 'published' && template._status === 'published') {
                        onCreated(template);
                        setSelection(String(template.id));
                        closeDrawer();
                    }
                } })] }), document.body);
}
