'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useConfig, UploadInput } from '@payloadcms/ui';
import { UnifiedBlockInspector } from './UnifiedBlockInspector.js';
export function RegisteredBlockEditor({ node, change, viewport, bindingFields, }) {
    const { config } = useConfig();
    const patch = (patch) => change({ ...node, ...patch });
    return (_jsxs(UnifiedBlockInspector, { bindingFields: bindingFields, viewport: viewport, node: node, onChange: patch, children: [_jsxs("label", { children: ["Block label", _jsx("input", { value: node.label ?? '', onChange: (event) => patch({ label: event.target.value }) })] }), ['heading', 'paragraph', 'quote', 'list', 'button', 'image'].includes(node.kind) && (_jsxs("label", { children: [node.kind === 'image' ? 'Caption' : 'Text', _jsx("textarea", { value: node.text ?? '', onChange: (event) => patch({ text: event.target.value }) })] })), node.kind === 'heading' && (_jsxs("label", { children: ["Heading level", _jsx("select", { value: node.level ?? 2, onChange: (event) => patch({ level: Number(event.target.value) }), children: [1, 2, 3, 4, 5, 6].map((level) => (_jsx("option", { children: level }, level))) })] })), ['button', 'video'].includes(node.kind) && (_jsxs("label", { children: ["URL", _jsx("input", { value: node.url ?? '', onChange: (event) => patch({ url: event.target.value }) })] })), ['image', 'gallery'].includes(node.kind) && (_jsxs(_Fragment, { children: [_jsx(UploadInput, { api: config.routes.api, allowCreate: true, hasMany: node.kind === 'gallery', isSortable: node.kind === 'gallery', label: "Image", onChange: (media) => patch({ media }), path: `block-media-${node.id}`, relationTo: "media", serverURL: config.serverURL, showError: false, value: node.media }), _jsxs("label", { children: ["Alternative text", _jsx("input", { value: node.alt ?? '', onChange: (event) => patch({ alt: event.target.value }) })] })] }))] }));
}
export function NewRegisteredBlock({ node, create, cancel, }) {
    const [draft, setDraft] = useState(node);
    return (_jsxs(_Fragment, { children: [_jsx(RegisteredBlockEditor, { node: draft, change: setDraft }), _jsx("button", { type: "button", onClick: () => create(draft), children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] }));
}
