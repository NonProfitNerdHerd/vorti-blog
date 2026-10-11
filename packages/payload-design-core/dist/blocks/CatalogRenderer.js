import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { lazy, Suspense } from 'react';
import { safeURL } from '../content/model.js';
import { getBlockDefinition } from './registry.js';
const Listing = lazy(() => import('./Listing'));
const ListingNavigation = lazy(() => import('./Listing').then((module) => ({ default: module.ListingNavigation })));
const InteractiveBlock = lazy(() => import('./InteractiveBlock'));
export const blockIcons = {
    check: '✓',
    star: '★',
    arrow: '→',
    heart: '♥',
    info: 'ⓘ',
    location: '⌖',
    mail: '✉',
    phone: '☎',
    plus: '+',
    minus: '−',
};
export function CatalogRenderer({ node, children, editing, }) {
    const props = node.props ?? {}, text = (key, fallback = '') => String(props[key] ?? fallback);
    const definition = getBlockDefinition(node.kind);
    if (definition?.render)
        return _jsx(_Fragment, { children: definition.render(node, children) });
    if ([
        'accordion',
        'tabs',
        'carousel',
        'expand',
        'notification',
        'countUp',
        'countdown',
        'videoPopup',
    ].includes(node.kind))
        return (_jsx(Suspense, { fallback: _jsx("div", { children: children }), children: _jsx(InteractiveBlock, { node: node, editing: editing, children: children }) }));
    const icon = _jsx("span", { "aria-hidden": "true", children: blockIcons[text('icon', 'star')] ?? '★' });
    switch (node.kind) {
        case 'icon':
            return (_jsx("span", { role: text('label') ? 'img' : undefined, "aria-label": text('label') || undefined, children: icon }));
        case 'iconButton':
            return (_jsx("a", { href: safeURL(props.url), "aria-label": text('label', 'Learn more'), children: icon }));
        case 'iconLabel':
            return (_jsxs("span", { children: [icon, " ", text('label')] }));
        case 'iconList':
            return (_jsx("ul", { style: { listStyle: 'none' }, children: text('items')
                    .split('\n')
                    .map((item, index) => (_jsxs("li", { children: [icon, " ", item] }, index))) }));
        case 'text':
        case 'subtitle':
            return _jsx("p", { style: { whiteSpace: 'pre-wrap' }, children: text('text') });
        case 'horizontalScroller':
            return (_jsx("div", { tabIndex: 0, "aria-label": "Scrollable content", style: { display: 'flex', overflowX: 'auto', gap: '1rem' }, children: children }));
        case 'progressBar':
        case 'progressCircle': {
            const max = Math.max(1, Number(props.max ?? 100)), value = Math.min(max, Math.max(0, Number(props.value ?? 60)));
            return (_jsxs("div", { children: [_jsx("span", { children: text('label', 'Progress') }), node.kind === 'progressBar' ? (_jsx("progress", { max: max, value: value, "aria-label": text('label', 'Progress') })) : (_jsxs("svg", { viewBox: "0 0 100 100", width: "120", role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": text('label', 'Progress'), children: [_jsx("circle", { cx: "50", cy: "50", r: "42", fill: "none", stroke: "currentColor", strokeWidth: "8", opacity: ".15" }), _jsx("circle", { cx: "50", cy: "50", r: "42", fill: "none", stroke: "currentColor", strokeWidth: "8", pathLength: "100", strokeDasharray: `${(value / max) * 100} 100`, transform: "rotate(-90 50 50)" }), _jsxs("text", { x: "50", y: "55", textAnchor: "middle", children: [Math.round((value / max) * 100), "%"] })] }))] }));
        }
        case 'numberBox':
            return (_jsxs("div", { children: [_jsx("strong", { children: text('value', '1') }), _jsx("p", { children: text('label') })] }));
        case 'price':
            return (_jsxs("p", { children: [_jsx("span", { children: text('currency', '$') }), _jsx("strong", { children: text('value', '29') }), _jsx("small", { children: text('period') })] }));
        case 'separator':
            return (_jsx("svg", { viewBox: "0 0 100 12", preserveAspectRatio: "none", "aria-hidden": "true", style: {
                    width: '100%',
                    height: '48px',
                    transform: props.flip ? 'rotate(180deg)' : undefined,
                }, children: _jsx("path", { fill: "currentColor", d: props.shape === 'angle'
                        ? 'M0 12 L100 0 L100 12 Z'
                        : props.shape === 'curve'
                            ? 'M0 0 Q50 24 100 0 V12 H0Z'
                            : 'M0 6 Q25 0 50 6 T100 6 V12 H0Z' }) }));
        case 'socialButtons':
            return (_jsx("nav", { "aria-label": "Social links", children: text('links')
                    .split('\n')
                    .filter(Boolean)
                    .map((line, index) => {
                    const [label, href] = line.split('|').map((value) => value.trim());
                    return (_jsx("a", { href: safeURL(href), rel: "noopener noreferrer", style: { marginInlineEnd: '1rem' }, children: label }, index));
                }) }));
        case 'map': {
            const latitude = Math.max(-85, Math.min(85, Number(props.latitude ?? 44.5))), longitude = Math.max(-180, Math.min(180, Number(props.longitude ?? -89.5))), delta = 180 / 2 ** Math.max(1, Math.min(18, Number(props.zoom ?? 10)));
            const params = new URLSearchParams({
                bbox: `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta}`,
                layer: 'mapnik',
                ...(props.marker === false ? {} : { marker: `${latitude},${longitude}` }),
            });
            return (_jsxs("figure", { children: [_jsx("iframe", { title: "Location map", loading: "lazy", src: `https://www.openstreetmap.org/export/embed.html?${params}`, style: { width: '100%', minHeight: '320px', border: 0 } }), _jsx("figcaption", { children: _jsx("a", { href: "https://www.openstreetmap.org/copyright", children: "\u00A9 OpenStreetMap contributors" }) })] }));
        }
        case 'tableOfContents':
            return (_jsx("nav", { "aria-label": "Table of contents", children: (Array.isArray(props.headings) ? props.headings : []).map((raw, index) => {
                    const heading = raw;
                    return (_jsx("div", { style: { paddingInlineStart: `${Math.max(0, heading.level - 2)}rem` }, children: _jsx("a", { href: `#${heading.id}`, children: heading.text }) }, index));
                }) }));
        case 'postListing':
            return (_jsx(Suspense, { fallback: _jsx("p", { children: "Loading listing?" }), children: _jsx(Listing, { node: node, editing: editing }) }));
        case 'pagination':
        case 'loadMore':
            return (_jsx(Suspense, { fallback: null, children: _jsx(ListingNavigation, { node: node, editing: editing }) }));
        default:
            return definition?.container ? (_jsx(_Fragment, { children: children })) : (_jsxs("p", { role: "alert", children: ["Block \u201C", node.kind, "\u201D is unavailable. Restore its registered definition to edit it; its saved data is retained."] }));
    }
}
