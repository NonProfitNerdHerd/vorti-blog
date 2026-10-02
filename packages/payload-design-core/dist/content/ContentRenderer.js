import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { RichText } from '@payloadcms/richtext-lexical/react';
import { HeroBoardRenderer } from '../hero-board/HeroBoard.js';
import { resolveStyle, safeURL, validStyleValue } from './model.js';
const mediaInfo = (value) => value && typeof value === 'object' ? value : {};
function declarations(node, viewport, base = {}) {
    const style = resolveStyle(node.styles, viewport);
    return ((style.borderWidth ? 'border-style:solid;' : '') +
        Object.entries({
            ...base,
            ...Object.fromEntries(Object.entries(style).filter(([key, value]) => validStyleValue(key, value))),
        })
            .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${value}`)
            .join(';'));
}
export function ContentBlock({ node, children, body, viewport, }) {
    const className = `content-block-${node.id.replace(/[^\w-]/g, '')}`;
    const base = node.kind === 'columns'
        ? {
            display: 'grid',
            gridTemplateColumns: (node.children ?? []).map(() => '1fr').join(' '),
            gap: '16px',
        }
        : node.kind === 'row'
            ? { display: 'flex', flexWrap: 'wrap', gap: '16px' }
            : {};
    const styles = Object.fromEntries(Object.entries(resolveStyle(node.styles, viewport)).filter(([key, value]) => validStyleValue(key, value)));
    if (styles.borderWidth)
        styles.borderStyle = 'solid';
    let content = children;
    const media = mediaInfo(node.media);
    if (!children)
        switch (node.kind) {
            case 'heading':
                content = React.createElement(`h${node.level ?? 2}`, {}, node.text);
                break;
            case 'paragraph':
                content = _jsx("p", { style: { whiteSpace: 'pre-wrap' }, children: node.text });
                break;
            case 'richText':
                content =
                    node.richText && typeof node.richText === 'object' && 'root' in node.richText ? (_jsx(RichText, { data: node.richText })) : null;
                break;
            case 'list': {
                const items = (node.text ?? '')
                    .split('\n')
                    .map((text, index) => _jsx("li", { children: text }, index));
                content = node.ordered ? _jsx("ol", { children: items }) : _jsx("ul", { children: items });
                break;
            }
            case 'quote':
                content = _jsx("blockquote", { style: { whiteSpace: 'pre-wrap' }, children: node.text });
                break;
            case 'image':
                content = media.url ? (_jsxs("figure", { children: [_jsx("img", { src: safeURL(media.url), alt: node.alt ?? media.alt ?? '', style: { maxWidth: '100%' } }), node.text && _jsx("figcaption", { children: node.text })] })) : null;
                break;
            case 'gallery':
                content = (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '16px' }, children: (Array.isArray(node.media) ? node.media : []).map((item, index) => {
                        const image = mediaInfo(item);
                        return image.url ? (_jsx("img", { src: safeURL(image.url), alt: image.alt ?? '', style: { maxWidth: '100%', width: '240px', objectFit: 'cover' } }, index)) : null;
                    }) }));
                break;
            case 'button':
                content = (_jsx("a", { className: "content-button", href: safeURL(node.url), children: node.text || 'Link' }));
                break;
            case 'video':
                content = safeURL(node.url) ? (_jsx("video", { controls: true, src: safeURL(node.url), style: { maxWidth: '100%' }, "aria-label": node.text || 'Video' })) : null;
                break;
            case 'divider':
                content = _jsx("hr", {});
                break;
            case 'spacer':
                content = _jsx("span", { "aria-hidden": "true" });
                break;
            case 'value':
                content = _jsx("span", { children: node.text });
                break;
            case 'designed':
                content =
                    node.rendererKey === 'hero-board' ? (_jsx(HeroBoardRenderer, { design: node.design ?? {}, values: (node.values ?? {}), headingLevel: 2 })) : (_jsx("p", { role: "alert", children: "This block\u2019s renderer is unavailable. Ask a designer to restore it." }));
                break;
        }
    if (node.kind !== 'richText' &&
        node.richText &&
        typeof node.richText === 'object' &&
        'root' in node.richText &&
        ['heading', 'paragraph', 'list', 'quote'].includes(node.kind))
        content = _jsx(RichText, { data: node.richText });
    return (_jsxs("div", { className: `content-block ${className}`, id: node.anchor, "data-block-kind": node.kind, style: viewport ? { ...base, ...styles } : undefined, children: [!viewport && (_jsx("style", { children: `.${className}{${declarations(node, 'desktop', base)}}@media(max-width:1024px){.${className}{${declarations(node, 'tablet', base)}}}@media(max-width:640px){.${className}{${declarations(node, 'mobile', base)}}}` })), body ?? content] }));
}
export function ContentRenderer({ nodes, viewport, }) {
    return (_jsx(_Fragment, { children: nodes.map((node) => (_jsx(ContentBlock, { node: node, viewport: viewport, children: node.children && _jsx(ContentRenderer, { nodes: node.children, viewport: viewport }) }, node.id))) }));
}
