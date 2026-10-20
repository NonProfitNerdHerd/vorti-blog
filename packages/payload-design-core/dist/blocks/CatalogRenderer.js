import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { isViewPlacement } from '../views/model.js';
import React, { lazy, Suspense } from 'react';
import { safeURL } from '../content/model.js';
import { getBlockDefinition } from './registry.js';
import { BlockIcon } from './Icons.js';
import { Separator } from './Separator.js';
import { blockItems } from './items.js';
import { DynamicView } from '../views/DynamicView.js';
import { Menu } from '../menus/Menu.js';
const Listing = lazy(() => import('./Listing'));
const FormPlacement = lazy(() => import('../forms/FormPlacement').then(module => ({ default: module.FormPlacement })));
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
export function CatalogRenderer({ node, children, editing, viewport, }) {
    const props = node.props ?? {}, text = (key, fallback = '') => String(props[key] ?? fallback);
    const definition = getBlockDefinition(node.kind);
    if (node.kind === 'menu')
        return _jsx(Menu, { menuID: text('menuID'), initial: props.resolvedMenu, editing: editing, depth: Math.max(1, Math.min(5, Number(props.depth) || 5)), orientation: text('orientation', 'horizontal'), alignment: text('alignment', 'start'), gap: text('gap', '1rem'), mobile: text('mobile', 'collapse'), label: text('label', 'Navigation'), submenuBackground: text('submenuBackground', '#ffffff'), submenuColor: text('submenuColor', '#1a1a1a'), submenuPadding: text('submenuPadding', '.5rem'), submenuBorder: text('submenuBorder', '1px solid #8884'), submenuRadius: text('submenuRadius', '8px'), hoverColor: text('hoverColor', '#4f46e5'), activeColor: text('activeColor', '#4f46e5') });
    if (node.kind === 'form')
        return _jsx(Suspense, { fallback: _jsx("p", { children: "Loading form\u2026" }), children: _jsx(FormPlacement, { formID: text('formID'), editing: editing }) });
    if (isViewPlacement(node.kind))
        return !props.viewID && editing
            ? _jsxs("div", { role: "status", children: [_jsx("strong", { children: definition?.label }), _jsx("p", { children: "Select this block to set up its content filters in the inspector, or choose an existing Saved View." })] })
            : _jsx(DynamicView, { viewID: text('viewID'), initial: props.resolvedView, editing: editing });
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
        return (_jsx(Suspense, { fallback: _jsx("div", { children: children }), children: _jsx(InteractiveBlock, { node: node, editing: editing, viewport: viewport, children: children }) }));
    const icon = _jsx(BlockIcon, { name: text('icon', 'star') });
    switch (node.kind) {
        case 'icon':
            return (_jsx("span", { role: text('label') ? 'img' : undefined, "aria-label": text('label') || undefined, children: icon }));
        case 'iconButton':
            return (_jsx("a", { className: "icon-button", href: safeURL(props.url), "aria-label": text('label', 'Learn more'), children: icon }));
        case 'iconLabel':
            return (_jsxs("span", { children: [icon, " ", text('label')] }));
        case 'iconList':
            return (_jsx("ul", { style: {
                    listStyle: 'none',
                    columnCount: Number(props.columns ?? 1),
                    paddingInlineStart: props.indent !== undefined ? `${Number(props.indent)}px` : undefined,
                }, children: blockItems(props.items).map((item, index) => (_jsxs("li", { style: {
                        breakInside: 'avoid',
                        marginBottom: props.itemGap !== undefined ? `${Number(props.itemGap)}px` : undefined,
                    }, children: [_jsx(BlockIcon, { name: item.icon ?? text('icon', 'check') }), ' ', item.url ? _jsx("a", { href: safeURL(item.url), children: item.label }) : item.label] }, index))) }));
        case 'text':
        case 'subtitle':
            return _jsx("p", { style: { whiteSpace: 'pre-wrap' }, children: text('text') });
        case 'horizontalScroller':
            return (_jsx("div", { className: "block-horizontal-scroller", tabIndex: 0, "aria-label": "Scrollable content", style: {
                    display: 'flex',
                    overflowX: 'auto',
                    gap: props.gap !== undefined ? `${Number(props.gap)}px` : '1rem',
                    scrollSnapType: props.snap ? 'x mandatory' : undefined,
                    scrollbarWidth: props.scrollbar === false ? 'none' : undefined,
                }, children: props.columns
                    ? React.Children.map(children, (child) => (_jsx("div", { style: {
                            flex: `0 0 calc((100% - ${Math.max(0, Number(props.columns) - 1) * Number(props.gap ?? 24)}px) / ${Math.max(1, Number(props.columns))})`,
                            scrollSnapAlign: 'start',
                            minWidth: 0,
                        }, children: child })))
                    : children }));
        case 'progressBar':
        case 'progressCircle': {
            const max = Math.max(1, Number(props.max ?? 100)), value = Math.min(max, Math.max(0, Number(props.value ?? 60)));
            return (_jsxs("div", { children: [_jsx("span", { className: "progress-label", children: text('label', 'Progress') }), node.kind === 'progressBar' && props.thickness === undefined ? (_jsx("progress", { max: max, value: value, "aria-label": text('label', 'Progress') })) : node.kind === 'progressBar' ? (_jsx("div", { className: "progress-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": value, "aria-label": text('label', 'Progress'), style: { borderRadius: props.rounded ? '999px' : 0, overflow: 'hidden' }, children: _jsx("div", { className: "progress-fill", style: {
                                width: `${(value / max) * 100}%`,
                                height: `${Number(props.thickness ?? 16)}px`,
                            } }) })) : (_jsxs("svg", { viewBox: "0 0 100 100", width: Number(props.size ?? 120), role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": text('label', 'Progress'), children: [_jsx("circle", { className: "progress-track", cx: "50", cy: "50", r: "42", fill: "none", stroke: "currentColor", strokeWidth: Number(props.thickness ?? 8), opacity: ".15" }), _jsx("circle", { className: "progress-fill", cx: "50", cy: "50", r: "42", fill: "none", stroke: "currentColor", strokeWidth: Number(props.thickness ?? 8), strokeLinecap: props.rounded ? 'round' : 'butt', pathLength: "100", strokeDasharray: `${(value / max) * 100} 100`, transform: "rotate(-90 50 50)" }), _jsxs("text", { className: "progress-label", x: "50", y: "55", textAnchor: "middle", children: [Math.round((value / max) * 100), "%"] })] }))] }));
        }
        case 'numberBox':
            return (_jsxs("div", { children: [_jsx("strong", { className: "number-badge", "data-shape": props.shape, style: props.shape && props.shape !== 'none'
                            ? {
                                display: 'inline-grid',
                                placeItems: 'center',
                                width: `${Number(props.size ?? 64)}px`,
                                height: `${Number(props.size ?? 64)}px`,
                                border: '2px solid currentColor',
                                borderRadius: props.shape === 'circle'
                                    ? '50%'
                                    : props.shape === 'rounded'
                                        ? '16px'
                                        : undefined,
                                transform: props.shape === 'diamond' ? 'rotate(45deg)' : undefined,
                            }
                            : undefined, children: _jsx("span", { style: { transform: props.shape === 'diamond' ? 'rotate(-45deg)' : undefined }, children: text('value', '1') }) }), _jsx("p", { className: "number-label", children: text('label') })] }));
        case 'price':
            return (_jsxs("p", { children: [_jsx("span", { className: "price-currency", children: text('currency', '$') }), _jsx("strong", { className: "price-amount", children: text('value', '29') }), _jsx("small", { className: "price-period", children: text('period') })] }));
        case 'separator':
            return (_jsx(Separator, { settings: {
                    shape: text('shape', 'wave'),
                    height: Number(props.height ?? 48),
                    width: Number(props.width ?? 100),
                    layers: Number(props.layers ?? 1),
                    flip: !!props.flip,
                    shadow: !!props.shadow,
                } }));
        case 'socialButtons':
            return (_jsx("nav", { "aria-label": "Social links", children: blockItems(props.links, true).map((item, index) => {
                    return (_jsxs("a", { className: "social-button", href: safeURL(item.url), rel: "noopener noreferrer", style: { marginInlineEnd: '1rem' }, children: [item.icon && _jsx(BlockIcon, { name: item.icon }), " ", item.label] }, index));
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
            return (_jsxs("nav", { "aria-label": "Table of contents", style: { columnCount: Number(props.columns ?? 1) }, children: [(!Array.isArray(props.headings) || !props.headings.length) && (_jsx("p", { children: "Add Heading blocks to this document to build a table of contents. Check the selected heading levels if headings are missing." })), (Array.isArray(props.headings) ? props.headings : []).map((raw, index) => {
                        const heading = raw;
                        return (_jsx("div", { style: {
                                paddingInlineStart: `${Math.max(0, heading.level - Number(props.minLevel ?? 2))}rem`,
                                marginBottom: `${Number(props.itemGap ?? 0)}px`,
                                breakInside: 'avoid',
                            }, children: _jsxs("a", { href: `#${heading.id}`, children: [props.numbered ? `${index + 1}. ` : '', heading.text] }) }, index));
                    })] }));
        case 'postListing':
            return (_jsx(Suspense, { fallback: _jsx("p", { children: "Loading listing?" }), children: _jsx(Listing, { node: node, editing: editing }) }));
        case 'pagination':
        case 'loadMore':
            return (_jsx(Suspense, { fallback: null, children: _jsx(ListingNavigation, { node: node, editing: editing }) }));
        default:
            return definition?.container ? (_jsx(_Fragment, { children: children })) : (_jsxs("p", { role: "alert", children: ["Block \u201C", node.kind, "\u201D is unavailable. Restore its registered definition to edit it; its saved data is retained."] }));
    }
}
