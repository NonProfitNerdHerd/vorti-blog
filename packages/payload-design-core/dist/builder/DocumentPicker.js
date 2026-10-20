'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useConfig } from '@payloadcms/ui';
import { useCategoriesEnabled } from '../categories.js';
export function DocumentPicker({ collection, label, value, change, }) {
    const { config } = useConfig();
    const available = useCategoriesEnabled() || collection !== 'categories';
    const [search, setSearch] = useState(''), [docs, setDocs] = useState([]), [error, setError] = useState('');
    const selected = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    useEffect(() => {
        if (!available)
            return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const titleField = collection === 'post-types'
                    ? 'singular'
                    : ['categories', 'tags', 'saved-views', 'menus'].includes(collection)
                        ? 'name'
                        : 'title';
                const params = new URLSearchParams({
                    limit: '50',
                    depth: '0',
                    sort: titleField,
                });
                if (search)
                    params.set(`where[${titleField}][like]`, search);
                if (collection === 'forms') {
                    params.set('where[_status][equals]', 'published');
                    params.set('where[archived][not_equals]', 'true');
                }
                const response = await fetch(`${config.serverURL ?? ''}${config.routes.api}/${collection === 'forms' ? 'forms-options' : collection}?${params}`, { signal: controller.signal, credentials: 'same-origin' });
                if (!response.ok)
                    throw new Error('Unable to load choices.');
                setDocs((await response.json()).docs ?? []);
                setError('');
            }
            catch (error) {
                if (!controller.signal.aborted)
                    setError(error.message);
            }
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [collection, search, config.routes.api, config.serverURL, available]);
    if (!available)
        return null;
    return (_jsxs("fieldset", { children: [_jsx("legend", { children: label }), _jsx("input", { "aria-label": `Search ${label}`, placeholder: "Search", value: search, onChange: (event) => setSearch(event.target.value) }), _jsxs("div", { className: "inspector-document-options", children: [selected
                        .filter((id) => !docs.some((doc) => String(doc.id) === id))
                        .map((id) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: true, onChange: () => change(selected.filter((item) => item !== id).join(',')) }), "Selected document ", id] }, id))), docs.map((doc) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: selected.includes(String(doc.id)), onChange: (event) => change((event.target.checked
                                    ? [...selected, String(doc.id)]
                                    : selected.filter((id) => id !== String(doc.id))).join(',')) }), doc.title ?? doc.name ?? doc.singular ?? String(doc.id)] }, doc.id)))] }), error && _jsx("p", { role: "alert", children: error })] }));
}
