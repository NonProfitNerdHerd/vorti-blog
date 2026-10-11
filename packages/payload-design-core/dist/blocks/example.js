import { jsx as _jsx } from "react/jsx-runtime";
import { registerBlock } from './registry.js';
/** Call once from the application's shared registration entry, imported by admin and public rendering. */
export function registerExampleBadge() {
    registerBlock({
        type: 'exampleBadge',
        version: 1,
        label: 'Badge',
        icon: '★',
        category: 'Text',
        description: 'A short label with the shared presentation controls.',
        keywords: ['label', 'badge'],
        contexts: ['content', 'template', 'header', 'footer'],
        fields: [
            { key: 'text', label: 'Badge text', type: 'text', defaultValue: 'New', bindable: true },
        ],
        controls: ['layout', 'typography', 'background', 'border', 'advanced'],
        render: (node) => _jsx("span", { role: "note", children: String(node.props?.text ?? '') }),
        outline: (node) => String(node.props?.text ?? ''),
        validate: (node) => String(node.props?.text ?? '').length > 120
            ? 'Badge text must be 120 characters or fewer.'
            : undefined,
    });
}
