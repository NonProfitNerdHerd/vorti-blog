'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useConfig, UploadInput } from '@payloadcms/ui';
import { UnifiedBlockInspector } from './UnifiedBlockInspector.js';
import { VariationPicker } from './VariationPicker.js';
import { BackgroundMediaPicker } from './BackgroundMediaPicker.js';
import { DocumentPicker } from './DocumentPicker.js';
import { styleOnlyKinds, variationsFor } from '../blocks/variations.js';
export function RegisteredBlockEditor({ node, change, viewport, bindingFields, listings, }) {
    const { config } = useConfig();
    const patch = (patch) => change({ ...node, ...patch });
    return (_jsxs(UnifiedBlockInspector, { listings: listings, renderDocumentPicker: (collection, label, value, change) => (_jsx(DocumentPicker, { collection: collection, label: label, value: value, change: change })), renderBackgroundMedia: (value, change) => (_jsx(BackgroundMediaPicker, { value: value, change: change })), bindingFields: bindingFields, viewport: viewport, node: node, onChange: patch, children: [_jsxs("label", { children: ["Block label", _jsx("input", { value: node.label ?? '', onChange: (event) => patch({ label: event.target.value }) })] }), ['heading', 'paragraph', 'quote', 'list', 'button', 'image'].includes(node.kind) && (_jsxs("label", { children: [node.kind === 'image' ? 'Caption' : 'Text', _jsx("textarea", { value: node.text ?? '', onChange: (event) => patch({ text: event.target.value }) })] })), node.kind === 'heading' && (_jsxs("label", { children: ["Heading level", _jsx("select", { value: node.level ?? 2, onChange: (event) => patch({ level: Number(event.target.value) }), children: [1, 2, 3, 4, 5, 6].map((level) => (_jsx("option", { children: level }, level))) })] })), ['button', 'video'].includes(node.kind) && (_jsxs("label", { children: ["URL", _jsx("input", { value: node.url ?? '', onChange: (event) => patch({ url: event.target.value }) })] })), ['image', 'gallery'].includes(node.kind) && (_jsxs(_Fragment, { children: [_jsx(UploadInput, { api: config.routes.api, allowCreate: true, hasMany: node.kind === 'gallery', isSortable: node.kind === 'gallery', label: "Image", onChange: (media) => patch({ media }), path: `block-media-${node.id}`, relationTo: "media", serverURL: config.serverURL, showError: false, value: node.media }), _jsxs("label", { children: ["Alternative text", _jsx("input", { value: node.alt ?? '', onChange: (event) => patch({ alt: event.target.value }) })] })] }))] }));
}
export function NewRegisteredBlock({ node, create, cancel, }) {
    const [draft, setDraft] = useState(node);
    const [choosing, setChoosing] = useState(variationsFor(node.kind).length > 1 && !styleOnlyKinds.has(node.kind));
    return (_jsxs(_Fragment, { children: [choosing ? (_jsx(VariationPicker, { node: draft, initial: true, onChange: setDraft, onDone: () => setChoosing(false) })) : (_jsx(RegisteredBlockEditor, { node: draft, change: setDraft })), _jsx("button", { type: "button", onClick: () => create(draft), children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] }));
}
