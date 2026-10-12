'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { defaultView } from './model.js';
export function SaveReusableView({ node, onChange, disabled, }) {
    const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const save = async () => {
        setBusy(true);
        setError('');
        const props = node.props || {}, ids = (value) => String(value || '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
        const configuration = {
            ...defaultView,
            layout: props.layout === 'list' ? 'list-1' : 'grid-1',
            query: {
                source: props.collection === 'pages' ? 'pages' : 'posts',
                ids: ids(props.ids),
                rules: props.collection !== 'pages' && ids(props.categories).length
                    ? [{ field: 'categories', operator: 'any', values: ids(props.categories) }]
                    : [],
                limit: Number(props.limit) || 6,
                sort: String(props.sort || '-publishedAt'),
            },
            image: props.showImage !== false,
            excerpt: props.showExcerpt !== false,
            taxonomy: props.showTaxonomy !== false,
            date: props.showDate !== false,
        };
        try {
            const response = await fetch('/api/saved-views', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim() || 'Reusable content view',
                    configuration,
                    _status: 'published',
                }),
            });
            const result = (await response.json());
            if (!response.ok || !result.doc)
                throw new Error(result.errors?.[0]?.message ||
                    'Unable to create view. Saved Views require design permission.');
            const styles = Object.fromEntries(Object.entries(node.styles || {}).map(([device, values]) => [
                device,
                Object.fromEntries(Object.entries(values || {}).filter(([key]) => /^(margin|padding|width|minWidth|maxWidth)/.test(key))),
            ]));
            onChange({
                kind: 'savedView',
                props: { viewID: String(result.doc.id) },
                variation: undefined,
                targetStyles: undefined,
                styles,
                presentation: undefined,
            });
        }
        catch (cause) {
            setError(cause.message);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("details", { children: [_jsx("summary", { children: "Make reusable" }), _jsxs("label", { children: ["View name", _jsx("input", { value: name, onChange: (e) => setName(e.target.value), disabled: disabled || busy })] }), _jsx("p", { children: "Creates a published Saved View and replaces this placement with its reference. Further layout changes belong to the central view." }), _jsx("button", { type: "button", disabled: disabled || busy, onClick: save, children: busy ? 'Saving…' : 'Save as reusable view' }), error && _jsx("p", { role: "alert", children: error })] }));
}
