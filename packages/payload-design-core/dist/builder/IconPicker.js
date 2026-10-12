'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { BlockIcon, iconPaths } from '../blocks/Icons.js';
export function IconPicker({ value, change }) {
    const [search, setSearch] = useState('');
    return (_jsxs("div", { children: [_jsx("input", { "aria-label": "Search icons", placeholder: "Search icons", value: search, onChange: (event) => setSearch(event.target.value) }), _jsx("div", { className: "inspector-icon-grid", children: Object.keys(iconPaths)
                    .filter((name) => name.includes(search.toLowerCase()))
                    .map((name) => (_jsx("button", { type: "button", title: name, "aria-label": name, "aria-pressed": value === name, onClick: () => change(name), children: _jsx(BlockIcon, { name: name }) }, name))) })] }));
}
