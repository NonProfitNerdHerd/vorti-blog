import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { RichText } from '@payloadcms/richtext-lexical/react';
import { HeroBoardRenderer } from '../hero-board/HeroBoard.js';
import { resolveStyle, safeURL, validStyleValue } from './model.js';
import { CatalogRenderer } from '../blocks/CatalogRenderer.js';
import { getBlockDefinition } from '../blocks/registry.js';
import { effectiveStyles, compositeKinds } from '../blocks/variations.js';
import { Composition } from '../blocks/Composition.js';
import { Separator } from '../blocks/Separator.js';
import { savedViewConverters } from '../views/RichView.js';
import { compileBlockCSS, conditionVisible, validatePresentation, resolveBackground, } from '../blocks/presentation.js';
const Motion = React.lazy(() => import('../blocks/Motion'));
const InteractiveBlock = React.lazy(() => import('../blocks/InteractiveBlock'));
const mediaInfo = (value) => value && typeof value === 'object' ? value : {};
function declarations(node, viewport, base = {}) {
    const style = resolveStyle(effectiveStyles(node), viewport);
    return ((style.borderWidth ? 'border-style:solid;' : '') +
        Object.entries({
            ...base,
            ...Object.fromEntries(Object.entries(style).filter(([key, value]) => validStyleValue(key, value))),
        })
            .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${value}`)
            .join(';'));
}
export function ContentBlock({ node, children, body, viewport, document = {}, }) {
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
    const styles = Object.fromEntries(Object.entries(resolveStyle(effectiveStyles(node), viewport)).filter(([key, value]) => validStyleValue(key, value)));
    if (styles.borderWidth)
        styles.borderStyle = 'solid';
    let headingIndex = 0;
    const converters = ({ defaultConverters }) => ({
        ...savedViewConverters({ defaultConverters }),
        heading: ({ node: heading, nodesToJSX }) => React.createElement(/^h[1-6]$/.test(heading.tag) ? heading.tag : 'h2', { id: `heading-${node.id}-${++headingIndex}` }, nodesToJSX({ nodes: heading.children })),
    });
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
                    node.richText && typeof node.richText === 'object' && 'root' in node.richText ? (_jsx(RichText, { data: node.richText, converters: converters })) : null;
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
                content = media.url ? (_jsxs("figure", { children: [_jsx("span", { className: "block-image-surface", children: _jsx("img", { src: safeURL(media.url), alt: node.alt ?? media.alt ?? '', style: { maxWidth: '100%' } }) }), node.text && _jsx("figcaption", { children: node.text })] })) : null;
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
            default:
                content = _jsx(CatalogRenderer, { node: node, editing: !!viewport, viewport: viewport });
        }
    if (children &&
        getBlockDefinition(node.kind)?.container &&
        !['group', 'row', 'columns', 'column'].includes(node.kind))
        content = (_jsx(CatalogRenderer, { node: node, editing: !!viewport, viewport: viewport, children: compositeKinds.has(node.kind) ? (_jsx(Composition, { node: node, children: children })) : (children) }));
    if (node.kind !== 'richText' &&
        node.richText &&
        typeof node.richText === 'object' &&
        'root' in node.richText &&
        ['heading', 'paragraph', 'list', 'quote'].includes(node.kind))
        content = _jsx(RichText, { data: node.richText, converters: converters });
    const definition = getBlockDefinition(node.kind);
    if (definition && (node.blockVersion ?? 1) > definition.version)
        content = (_jsx("p", { role: "alert", children: "This block was saved with a newer version. Update its registered definition to edit it; its saved data is retained." }));
    else if (!definition && !['value', 'designed'].includes(node.kind) && children)
        content = (_jsxs(_Fragment, { children: [_jsxs("p", { role: "alert", children: ["Block ?", node.kind, "? is unavailable. Restore its registered definition; its saved data is retained."] }), children] }));
    const presentation = validatePresentation(node.presentation) ? {} : (node.presentation ?? {});
    const Tag = presentation.tag ?? 'div';
    const background = resolveBackground(presentation.background, viewport);
    const backgroundStyle = background?.imageURL && (!background.mode || background.mode === 'image')
        ? {
            backgroundImage: `url("${background.imageURL}")`,
            backgroundSize: background.fit ?? 'cover',
            backgroundPosition: background.position ?? 'center',
            backgroundRepeat: background.repeat ?? 'no-repeat',
        }
        : background.mode === 'solid' || background.mode === 'image'
            ? { backgroundImage: 'none' }
            : {};
    const hasOverlay = ['desktop', 'tablet', 'mobile'].some((device) => {
        const value = resolveBackground(presentation.background, device);
        return !!(value.overlay || value.gradient);
    });
    const overlayVariables = hasOverlay && ['image', 'imageBox'].includes(node.kind)
        ? {
            '--block-overlay': background?.gradient || background?.overlay,
            '--block-overlay-opacity': background?.opacity ?? 0,
            '--block-overlay-blend': background?.blendMode ?? 'normal',
        }
        : {};
    const css = compileBlockCSS(presentation.css, `.${className}`);
    const stateRule = (state) => `.${className}:${state === 'focus' ? 'focus-within' : 'hover'}{${Object.entries(presentation[state] ?? {})
        .filter(([key, value]) => validStyleValue(key, value))
        .map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`)
        .join(';')}}`;
    let rendered = body ?? content;
    if (presentation.link?.lightbox)
        rendered = (_jsx(React.Suspense, { fallback: rendered, children: _jsx(InteractiveBlock, { node: node, editing: !!viewport, children: rendered }) }));
    else if (safeURL(presentation.link?.url))
        rendered = (_jsx("a", { href: safeURL(presentation.link?.url), target: presentation.link?.newTab ? '_blank' : undefined, rel: presentation.link?.newTab ? 'noopener noreferrer' : presentation.link?.rel, title: presentation.link?.title, children: rendered }));
    const imageRule = (device) => {
        const resolved = resolveStyle(node.styles, device);
        return `.${className} > figure > .block-image-surface > img{width:100%;object-fit:${resolved.objectFit ?? 'cover'};object-position:${resolved.objectPosition ?? '50% 50%'};aspect-ratio:${resolved.aspectRatio ?? 'auto'}}`;
    };
    const imageCSS = viewport
        ? imageRule(viewport)
        : `${imageRule('desktop')}@media(max-width:1024px){${imageRule('tablet')}}@media(max-width:640px){${imageRule('mobile')}}`;
    const treatment = presentation.media;
    const shape = treatment?.shape;
    const mediaRoot = node.kind === 'image'
        ? `.${className} > figure > .block-image-surface`
        : `.${className} > .block-composition > .block-media`;
    const treatmentCSS = treatment
        ? `${mediaRoot}{overflow:hidden;${shape === 'circle' ? 'clip-path:circle(50%)' : shape === 'ellipse' ? 'clip-path:ellipse(50% 40%)' : shape === 'diagonal' ? 'clip-path:polygon(15% 0,100% 0,85% 100%,0 100%)' : shape === 'blob' ? 'border-radius:40% 60% 55% 45% / 35% 45% 55% 65%' : shape === 'rounded' ? 'border-radius:24px' : ''}}${mediaRoot} img{transform:scale(${treatment.zoom ?? 1});filter:brightness(${treatment.brightness ?? 1}) contrast(${treatment.contrast ?? 1}) saturate(${treatment.saturation ?? 1}) grayscale(${treatment.grayscale ?? 0}) blur(${treatment.blur ?? 0}px)}`
        : '';
    const targetRule = (device) => (definition?.targets ?? [])
        .map((target) => {
        const styles = node.targetStyles?.[target.id];
        const selector = `.${className} ${target.selector}`;
        return `${selector}{${declarations({ ...node, variation: undefined, styles }, device)}}${viewport ? `.${className}[data-inspector-target="${target.id}"] ${target.selector}{outline:2px dashed #3858e9;outline-offset:3px}` : ''}`;
    })
        .join('');
    const targetCSS = viewport
        ? targetRule(viewport)
        : `${targetRule('desktop')}@media(max-width:1024px){${targetRule('tablet')}}@media(max-width:640px){${targetRule('mobile')}}`;
    const backgroundRule = (device) => {
        if (!presentation.background)
            return '';
        const value = resolveBackground(presentation.background, device);
        const image = value.mode === 'solid'
            ? 'none'
            : value.imageURL && (!value.mode || value.mode === 'image')
                ? `url("${value.imageURL}")`
                : value.mode === 'image'
                    ? 'none'
                    : undefined;
        return `.${className}{${image ? `background-image:${image};` : ''}background-size:${value.fit ?? 'cover'};background-position:${value.position ?? 'center'};background-repeat:${value.repeat ?? 'no-repeat'};--block-overlay:${value.gradient || value.overlay || 'transparent'};--block-overlay-opacity:${value.opacity ?? 0};--block-overlay-blend:${value.blendMode ?? 'normal'}}`;
    };
    const backgroundCSS = viewport
        ? backgroundRule(viewport)
        : `${backgroundRule('desktop')}@media(max-width:1024px){${backgroundRule('tablet')}}@media(max-width:640px){${backgroundRule('mobile')}}`;
    return (_jsxs(Tag, { ...presentation.attributes, className: `content-block ${className} ${presentation.className ?? ''}`, id: node.anchor, "data-motion-id": node.id, "data-block-kind": node.kind, "data-variation": node.variation?.id, "data-role": node.role, "data-heading-decoration": node.kind === 'heading' ? String(node.props?.decoration ?? 'none') : undefined, "data-editor-device": viewport, style: viewport ? { ...base, ...styles, ...backgroundStyle, ...overlayVariables } : undefined, children: [_jsx("style", { children: targetCSS + treatmentCSS }), node.kind === 'heading' && (_jsx("style", { children: `.${className}[data-heading-decoration]:before,.${className}[data-heading-decoration]:after{display:block;width:${Math.min(100, Math.max(1, Number(node.props?.decorationWidth ?? 30)))}%;border-top:3px solid currentColor;margin-block:12px}.${className}[data-heading-decoration='top-line']:before,.${className}[data-heading-decoration='both-lines']:before,.${className}[data-heading-decoration='bottom-line']:after,.${className}[data-heading-decoration='both-lines']:after{content:''}` })), !viewport && (_jsx("style", { children: `.${className}{${declarations(node, 'desktop', base)}}@media(max-width:1024px){.${className}{${declarations(node, 'tablet', base)}}}@media(max-width:640px){.${className}{${declarations(node, 'mobile', base)}}}` })), _jsx("style", { children: `${css}${stateRule('hover')}${stateRule('focus')}${imageCSS}${backgroundCSS}${!viewport ? ['desktop', 'tablet', 'mobile'].map((device) => (presentation.hidden?.[device] ? `@media ${device === 'desktop' ? '(min-width:1025px)' : device === 'tablet' ? '(min-width:641px) and (max-width:1024px)' : '(max-width:640px)'}{.${className}{display:none}}` : '')).join('') : ''}` }), viewport && presentation.hidden?.[viewport] && (_jsxs("p", { role: "status", children: ["Hidden on ", viewport, " in published content."] })), viewport && !conditionVisible(presentation.condition, document) && (_jsx("p", { role: "status", children: "Hidden by display conditions for this preview document." })), !viewport && presentation.motion && (_jsx(React.Suspense, { fallback: null, children: _jsx(Motion, { id: node.id, motion: presentation.motion }) })), _jsx("style", { children: `.${className} .block-image-surface{display:block;position:relative;isolation:isolate}.${className} .block-image-surface:after{content:'';position:absolute;inset:0;pointer-events:none;background:var(--block-overlay,transparent);opacity:var(--block-overlay-opacity,0);mix-blend-mode:var(--block-overlay-blend,normal);border-radius:inherit}.${className} .block-image-surface img{display:block}` }), hasOverlay && !['image', 'imageBox'].includes(node.kind) && (_jsxs(_Fragment, { children: [_jsx("style", { children: `.${className}{position:relative;isolation:isolate}.${className}>.block-overlay{position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:-1}` }), _jsx("span", { "aria-hidden": "true", className: "block-overlay", style: {
                            background: 'var(--block-overlay)',
                            opacity: 'var(--block-overlay-opacity)',
                            mixBlendMode: 'var(--block-overlay-blend)',
                        } })] })), presentation.separators?.top && _jsx(Separator, { settings: presentation.separators.top }), rendered, presentation.separators?.bottom && _jsx(Separator, { settings: presentation.separators.bottom })] }));
}
export function ContentRenderer({ nodes, viewport, }) {
    return (_jsx(_Fragment, { children: nodes.map((node) => (_jsx(ContentBlock, { node: node, viewport: viewport, children: node.children?.map((child) => (_jsx(ContentRenderer, { nodes: [child], viewport: viewport }, child.id))) }, node.id))) }));
}
