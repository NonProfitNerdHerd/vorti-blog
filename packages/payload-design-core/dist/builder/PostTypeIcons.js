'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { BlockGlyph } from '../blocks/BlockGlyph.js';
let catalogPromise;
const load = () => (catalogPromise ||= import('./PostTypeIconCatalog'));
export function PostTypeIcon({ value }) {
    const [catalog, setCatalog] = useState();
    useEffect(() => {
        if (value.startsWith('lucide:'))
            void load().then(setCatalog);
    }, [value]);
    if (!value.startsWith('lucide:'))
        return _jsx(BlockGlyph, { kind: value });
    const Icon = catalog?.catalog[value.slice(7)];
    return Icon ? _jsx(Icon, { size: 22, "aria-hidden": true }) : _jsx("span", { "aria-hidden": true, children: "\u25C7" });
}
const categories = {
    'Time & events': /calendar|clock|alarm|timer|hourglass|ticket|party/,
    'People & community': /user|person|contact|hand|heart|accessibility/,
    'Content & communication': /file|book|newspaper|mail|message|notebook|text|pen|folder/,
    'Places & travel': /map|pin|house|building|landmark|plane|car|bus|train|hotel|compass/,
    'Business & shopping': /briefcase|chart|badge|credit|wallet|dollar|store|shopping|receipt|package/,
    'Media & technology': /image|camera|video|music|mic|computer|monitor|phone|server|code|wifi/,
    'Nature & activities': /tree|flower|leaf|sun|cloud|moon|mountain|bike|ball|tent|fish|bird/,
};
export function PostTypeIconPicker({ value, onChange, disabled, }) {
    const [catalog, setCatalog] = useState(), [error, setError] = useState(false);
    const [search, setSearch] = useState(''), [category, setCategory] = useState('All'), [limit, setLimit] = useState(60);
    useEffect(() => {
        void load()
            .then(setCatalog)
            .catch(() => setError(true));
    }, []);
    const names = Object.keys(catalog?.catalog || {}).filter((name) => {
        const normalized = name.replace(/([A-Z])/g, ' $1').toLowerCase();
        const query = search.toLowerCase().replace(/events?|dates?/g, 'calendar');
        return (normalized.includes(query) && (category === 'All' || categories[category].test(normalized)));
    });
    return (_jsxs("fieldset", { disabled: disabled, className: "pt-icons", children: [_jsx("legend", { children: "Post Type icon" }), _jsxs("p", { children: [_jsx(PostTypeIcon, { value: value }), " Selected: ", value.replace('lucide:', '')] }), _jsxs("label", { children: ["Search icons", _jsx("input", { type: "search", value: search, placeholder: "Calendar, people, news, location\u2026", onChange: (e) => {
                            setSearch(e.target.value);
                            setLimit(60);
                        } })] }), _jsxs("label", { children: ["Category", _jsx("select", { value: category, onChange: (e) => {
                            setCategory(e.target.value);
                            setLimit(60);
                        }, children: ['All', ...Object.keys(categories)].map((c) => (_jsx("option", { children: c }, c))) })] }), !catalog && (_jsx("p", { role: "status", children: error
                    ? 'Icons could not load. Reload this page to retry; your current icon is unchanged.'
                    : 'Loading icon library…' })), catalog && _jsxs("p", { role: "status", children: [names.length, " icons found"] }), _jsx("div", { className: "pt-icon-grid", children: names.slice(0, limit).map((name) => {
                    const Icon = catalog.catalog[name];
                    return (_jsxs("button", { type: "button", title: name, "aria-label": name, "aria-pressed": value === `lucide:${name}`, onClick: () => onChange(`lucide:${name}`), children: [_jsx(Icon, { size: 24, "aria-hidden": true }), _jsx("small", { children: name.replace(/([A-Z])/g, ' $1').trim() })] }, name));
                }) }), names.length > limit && (_jsx("button", { type: "button", onClick: () => setLimit(limit + 60), children: "Show more icons" }))] }));
}
