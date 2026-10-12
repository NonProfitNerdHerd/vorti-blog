'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useConfig } from '@payloadcms/ui';
export function DocumentPicker({ collection, label, value, change, }) {
    const { config } = useConfig();
    const [search, setSearch] = useState(''), [docs, setDocs] = useState([]), [error, setError] = useState('');
    const selected = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    limit: '50',
                    depth: '0',
                    sort: collection === 'categories' ? 'name' : 'title',
                });
                if (search)
                    params.set(`where[${collection === 'categories' ? 'name' : 'title'}][like]`, search);
                const response = await fetch(`${config.serverURL ?? ''}${config.routes.api}/${collection}?${params}`, { signal: controller.signal, credentials: 'same-origin' });
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
    }, [collection, search, config.routes.api, config.serverURL]);
    return (_jsxs("fieldset", { children: [_jsx("legend", { children: label }), _jsx("input", { "aria-label": `Search ${label}`, placeholder: "Search", value: search, onChange: (event) => setSearch(event.target.value) }), _jsxs("div", { className: "inspector-document-options", children: [selected
                        .filter((id) => !docs.some((doc) => String(doc.id) === id))
                        .map((id) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: true, onChange: () => change(selected.filter((item) => item !== id).join(',')) }), "Selected document ", id] }, id))), docs.map((doc) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: selected.includes(String(doc.id)), onChange: (event) => change((event.target.checked
                                    ? [...selected, String(doc.id)]
                                    : selected.filter((id) => id !== String(doc.id))).join(',')) }), doc.title ?? doc.name ?? String(doc.id)] }, doc.id)))] }), error && _jsx("p", { role: "alert", children: error })] }));
}
