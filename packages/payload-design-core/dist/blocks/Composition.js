import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Children, Fragment, isValidElement } from 'react';
import { compositeKinds, roleFor } from './variations.js';
import './variations.css';
export function Composition({ node, children }) {
    if (!node.variation || !compositeKinds.has(node.kind))
        return _jsx(_Fragment, { children: children });
    const list = isValidElement(children) && children.type === Fragment
        ? Children.toArray(children.props.children)
        : Children.toArray(children);
    const nodes = node.children ?? [];
    const wrap = (child, index) => (_jsx("div", { "data-role": nodes[index] ? roleFor(nodes[index]) : 'extra', children: child }, nodes[index]?.id ?? index));
    if (['featureGrid', 'timeline'].includes(node.kind))
        return (_jsx("div", { className: `block-composition block-repeater ${node.kind === 'timeline' ? 'block-timeline' : ''}`, children: list.map((child, index) => (_jsxs("div", { className: "block-repeat-item", "data-role": "item", children: [node.kind === 'timeline' && (_jsxs(_Fragment, { children: [_jsx("span", { className: "timeline-marker", "aria-hidden": "true", children: nodes[index]?.props?.marker || index + 1 }), _jsx("time", { children: String(nodes[index]?.props?.date ?? '') })] })), child] }, nodes[index]?.id ?? index))) }));
    return (_jsxs("div", { className: "block-composition", children: [nodes.some((n) => roleFor(n) === 'media') && (_jsx("div", { className: "block-media", children: list.map((child, index) => nodes[index] && roleFor(nodes[index]) === 'media' ? wrap(child, index) : null) })), _jsx("div", { className: "block-content", children: list.map((child, index) => !nodes[index] || !['media', 'extra'].includes(roleFor(nodes[index]))
                    ? wrap(child, index)
                    : null) }), nodes.some((n) => roleFor(n) === 'extra') && (_jsx("div", { className: "block-extra", "aria-label": "Additional content", children: list.map((child, index) => nodes[index] && roleFor(nodes[index]) === 'extra' ? wrap(child, index) : null) }))] }));
}
