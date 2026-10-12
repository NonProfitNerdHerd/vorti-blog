'use client';
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { defaultView, viewForBlock } from './model.js';
export function ViewPlacementSetup({ node, onChange, renderPicker, }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const view = viewForBlock(node.kind);
    if (!view || node.props?.viewID)
        return null;
    const setup = node.props?.viewSetup;
    const configuration = setup?.configuration ?? {
        ...defaultView,
        layout: view.key,
        query: {
            ...defaultView.query,
            sort: view.family === 'events' ? 'publishedAt' : '-publishedAt',
        },
    };
    const name = setup?.name ?? view.label;
    const update = (patch, nextName = name) => onChange({
        props: {
            ...node.props,
            viewSetup: { name: nextName, configuration: { ...configuration, ...patch } },
        },
    });
    const query = (patch) => update({ query: { ...configuration.query, ...patch } });
    const rules = configuration.query.rules ?? [];
    const filter = (field, ids) => {
        const existing = rules.find((rule) => rule.field === field);
        query({
            rules: [
                ...rules.filter((rule) => rule.field !== field),
                {
                    field,
                    operator: existing?.operator ?? 'any',
                    values: ids.split(',').filter(Boolean),
                },
            ].filter((rule) => rule.values.length),
        });
    };
    const create = async () => {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/saved-views', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim() || view.label,
                    configuration,
                    _status: 'published',
                }),
            });
            const result = (await response.json());
            if (!response.ok || !result.doc?.id)
                throw new Error(result.errors?.[0]?.message || 'Unable to create view. Design permission is required.');
            const { viewSetup: _setup, ...props } = node.props ?? {};
            onChange({ props: { ...props, viewID: String(result.doc.id) } });
        }
        catch (cause) {
            setError(cause.message);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("fieldset", { disabled: busy, className: "view-placement-setup", children: [_jsxs("legend", { children: ["Set up ", view.label] }), _jsx("p", { children: "Create a reusable view here, or choose an existing Saved View below. Publishing changes to that view updates every placement." }), _jsxs("label", { children: ["View name", _jsx("input", { value: name, onChange: (event) => update({}, event.target.value) })] }), view.family !== 'events' && (_jsxs("label", { children: ["Content source", _jsxs("select", { value: configuration.query.source, onChange: (event) => query({ source: event.target.value, rules: [], postTypes: [] }), children: [_jsx("option", { value: "posts", children: "Posts" }), _jsx("option", { value: "pages", children: "Pages" })] })] })), configuration.query.source === 'posts' && (_jsxs(_Fragment, { children: [renderPicker?.('post-types', 'Post Types', configuration.query.postTypes?.join(',') ?? '', (value) => query({ postTypes: value.split(',').filter(Boolean) })), view.family === 'events' && (_jsx("p", { children: "Only event-capable Post Types are included. Leave Post Types empty to include all event types." })), ['categories', 'tags'].map((field) => (_jsxs("div", { children: [renderPicker?.(field, field === 'categories' ? 'Categories' : 'Tags', rules.find((rule) => rule.field === field)?.values.join(',') ?? '', (value) => filter(field, value)), _jsxs("label", { children: [field === 'categories' ? 'Category matching' : 'Tag matching', _jsxs("select", { value: rules.find((rule) => rule.field === field)?.operator ?? 'any', onChange: (event) => query({
                                            rules: [
                                                ...rules.filter((rule) => rule.field !== field),
                                                {
                                                    field,
                                                    operator: event.target.value,
                                                    values: rules.find((rule) => rule.field === field)?.values ?? [],
                                                },
                                            ],
                                        }), children: [_jsx("option", { value: "any", children: "Any selected" }), _jsx("option", { value: "all", children: "All selected" }), _jsx("option", { value: "exclude", children: "Exclude selected" })] })] })] }, field))), _jsxs("label", { children: ["Combine filters", _jsxs("select", { value: configuration.query.match ?? 'and', onChange: (event) => query({ match: event.target.value }), children: [_jsx("option", { value: "and", children: "Match all filters" }), _jsx("option", { value: "or", children: "Match any filter" })] })] })] })), _jsxs("label", { children: ["Items per page", _jsx("input", { type: "number", min: 1, max: 100, value: configuration.query.limit ?? 9, onChange: (event) => query({ limit: Number(event.target.value) }) })] }), _jsxs("label", { children: ["Pagination", _jsxs("select", { value: configuration.pagination ?? 'numbers', onChange: (event) => update({ pagination: event.target.value }), children: [_jsx("option", { value: "numbers", children: "Page numbers" }), _jsx("option", { value: "navigation", children: "Previous / next" }), _jsx("option", { value: "more", children: "Load more" }), _jsx("option", { value: "none", children: "None" })] })] }), _jsx("button", { type: "button", disabled: busy, onClick: create, children: busy ? 'Creating view…' : 'Create view and use here' }), error && _jsx("p", { role: "alert", children: error })] }));
}
