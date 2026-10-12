'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RenderLexical } from '@payloadcms/richtext-lexical/client';
import { useConfig } from '@payloadcms/ui';
import { getFieldPaths } from 'payload/shared';
import { useState } from 'react';
import { textDocument } from '../content/model.js';
import { InlineText } from './InlineText.js';
function contentEditorPath(fields, parentSchemaPath, parentIndexPath = '') {
    for (const [index, field] of fields.entries()) {
        const paths = getFieldPaths({ field, index, parentSchemaPath, parentIndexPath, parentPath: '' });
        if (field.type === 'richText' && field.name === 'content')
            return paths.schemaPath;
        if ('fields' in field) {
            const found = contentEditorPath(field.fields, paths.schemaPath, paths.indexPath);
            if (found)
                return found;
        }
    }
}
/** Resolve an existing host content editor; no extra rich-text field or storage is created. */
export function RegisteredCanvasText({ node, disabled, change, }) {
    const { config } = useConfig();
    const [focused, setFocused] = useState(false);
    const schemaPath = config.collections
        ?.map((collection) => contentEditorPath(collection.fields, `collection.${collection.slug}`))
        .find(Boolean);
    if (node.kind === 'richText' || node.richText) {
        if (!schemaPath)
            return _jsx("p", { children: "The host content editor is unavailable." });
        return (_jsx(RenderLexical, { field: { name: 'content', type: 'richText', label: false, admin: { readOnly: disabled } }, path: `editorText.${node.id}`, schemaPath: schemaPath, value: node.richText, setValue: (richText) => change({ richText }) }));
    }
    return (_jsxs("div", { onFocusCapture: () => setFocused(true), onBlurCapture: (event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
                setFocused(false);
        }, children: [_jsx(InlineText, { node: node, disabled: disabled, onChange: (text) => change({ text }) }), focused && !disabled && schemaPath && node.kind !== 'button' && (_jsx("button", { type: "button", onClick: () => change({ richText: textDocument(node) }), children: "Format text" }))] }));
}
