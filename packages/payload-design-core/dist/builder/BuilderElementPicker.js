'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
export function BuilderElementPicker({ categories, categoryLabels, close, elements, onChoose, }) {
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const normalized = query.trim().toLowerCase();
    const matches = elements.filter((item) => {
        const matchesCategory = category === 'all' || item.category === category;
        const matchesQuery = !normalized || [item.label, item.description, ...item.keywords].some((value) => value.toLowerCase().includes(normalized));
        return matchesCategory && matchesQuery;
    });
    return (_jsx("div", { role: "presentation", className: "template-editor__picker-backdrop", onMouseDown: (event) => { if (event.currentTarget === event.target)
            close(); }, children: _jsxs("section", { role: "dialog", "aria-modal": "true", "aria-labelledby": "element-picker-title", className: "template-editor__picker", children: [_jsxs("header", { className: "template-editor__picker-header", children: [_jsxs("div", { children: [_jsx("h2", { id: "element-picker-title", children: "Add an element" }), _jsx("p", { children: "Choose what to place in this area." })] }), _jsx("button", { type: "button", className: "template-editor__picker-close", "aria-label": "Close element picker", onClick: close, children: "\u00D7" })] }), _jsxs("label", { className: "template-editor__picker-search", children: [_jsx("span", { "aria-hidden": "true", children: "\u2315" }), _jsx("input", { autoFocus: true, "aria-label": "Search elements", type: "search", placeholder: "Search blocks and elements", value: query, onChange: (event) => setQuery(event.target.value) })] }), _jsx("div", { role: "tablist", "aria-label": "Block categories", className: "template-editor__picker-tabs", children: categories.map((item) => _jsx("button", { type: "button", role: "tab", "aria-selected": category === item, onClick: () => setCategory(item), children: item === 'all' ? 'All' : categoryLabels[item] }, item)) }), _jsxs("div", { className: "template-editor__picker-results", children: [category === 'all' && !query
                            ? [...new Set(matches.map((item) => item.category))].map((group) => _jsxs("section", { className: "template-editor__picker-section", children: [_jsx("h3", { children: categoryLabels[group] }), _jsx("div", { className: "template-editor__picker-grid", children: matches.filter((item) => item.category === group).map((item) => _jsx(PickerOption, { item: item, choose: onChoose }, `${item.kind}:${item.value}`)) })] }, group))
                            : _jsx("div", { className: "template-editor__picker-grid", children: matches.map((item) => _jsx(PickerOption, { item: item, choose: onChoose }, `${item.kind}:${item.value}`)) }), !matches.length && _jsxs("div", { className: "template-editor__picker-empty", children: [_jsx("strong", { children: "No matching blocks" }), _jsx("span", { children: "Try another search or category." })] })] })] }) }));
}
function PickerOption({ choose, item }) {
    return _jsxs("button", { type: "button", className: "template-editor__picker-card", onClick: () => choose(item), children: [_jsx("span", { className: "template-editor__picker-card-icon", "aria-hidden": "true", children: item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶' }), _jsxs("span", { children: [_jsx("strong", { children: item.label }), _jsx("small", { children: item.description })] })] });
}
