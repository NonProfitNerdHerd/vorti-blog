import { blockDefaults, canInsertBlock, getBlockDefinition, listBlockDefinitions, } from '../blocks/registry.js';
import { publicDocumentFields, validatePresentation, } from '../blocks/presentation.js';
import { dimensionKeys, extendedStyleValue } from '../blocks/style-schema.js';
import { validateVariation, variationsFor, applyVariation, compositeKinds, } from '../blocks/variations.js';
export const contentLibrary = [
    ['heading', 'Heading', 'Text'],
    ['paragraph', 'Paragraph', 'Text'],
    ['richText', 'Rich text', 'Text'],
    ['list', 'List', 'Text'],
    ['quote', 'Quote', 'Text'],
    ['image', 'Image', 'Media'],
    ['gallery', 'Gallery', 'Media'],
    ['button', 'Button / link', 'Text'],
    ['video', 'Video', 'Media'],
    ['group', 'Group', 'Layout'],
    ['row', 'Row', 'Layout'],
    ['columns', 'Columns', 'Layout'],
    ['spacer', 'Spacer', 'Layout'],
    ['divider', 'Divider', 'Layout'],
].map(([kind, label, category]) => ({ kind: kind, label, category }));
for (const definition of listBlockDefinitions()) {
    if (definition.type !== 'column' && !contentLibrary.some((item) => item.kind === definition.type))
        contentLibrary.push({
            kind: definition.type,
            label: definition.label,
            category: definition.category,
        });
}
export const containerKinds = new (class extends Set {
    has(kind) {
        return !!getBlockDefinition(kind)?.container;
    }
})(listBlockDefinitions()
    .filter((item) => item.container)
    .map((item) => item.type));
export const getContentLibrary = () => [
    ...contentLibrary,
    ...listBlockDefinitions()
        .filter((item) => item.type !== 'column' && !contentLibrary.some((existing) => existing.kind === item.type))
        .map((item) => ({ kind: item.type, label: item.label, category: item.category })),
];
export function createContentNode(kind) {
    const node = {
        id: `b_${crypto.randomUUID()}`,
        kind,
        label: getBlockDefinition(kind)?.label ??
            contentLibrary.find((item) => item.kind === kind)?.label ??
            kind,
        ...blockDefaults(kind),
    };
    if (containerKinds.has(kind))
        node.children =
            kind === 'columns'
                ? [createContentNode('column'), createContentNode('column')]
                : (node.children ?? []);
    if (kind === 'columns')
        node.styles = { tablet: { gridTemplateColumns: '1fr' } };
    if (kind === 'heading')
        node.level = 2;
    if (kind === 'spacer')
        node.styles = { desktop: { minHeight: '32px' } };
    const initializeChildren = (children) => children.map((child) => {
        const nested = { ...child, children: child.children && initializeChildren(child.children) };
        const variation = variationsFor(child.kind)[0];
        return variation
            ? applyVariation({ ...nested, styles: compositeKinds.has(child.kind) ? undefined : child.styles }, variation.id)
            : nested;
    });
    if (node.children)
        node.children = initializeChildren(node.children);
    if (['card', 'hero'].includes(kind))
        node.children = [
            createContentNode('image'),
            createContentNode('heading'),
            createContentNode('paragraph'),
            createContentNode('button'),
        ].map((child) => ({
            ...child,
            text: child.kind === 'heading'
                ? node.label
                : child.kind === 'paragraph'
                    ? 'Add your content here'
                    : child.kind === 'button'
                        ? 'Learn more'
                        : undefined,
        }));
    const variation = variationsFor(kind)[0];
    if (variation) {
        if (compositeKinds.has(kind))
            node.styles = undefined;
        return applyVariation(node, variation.id);
    }
    return node;
}
export function walkContent(nodes) {
    return nodes.flatMap((node) => [node, ...walkContent(node.children ?? [])]);
}
export function updateContent(nodes, id, update) {
    return nodes.map((node) => node.id === id
        ? update(node)
        : node.children
            ? { ...node, children: updateContent(node.children, id, update) }
            : node);
}
export function removeContent(nodes, id) {
    return nodes
        .filter((node) => node.id !== id)
        .map((node) => (node.children ? { ...node, children: removeContent(node.children, id) } : node));
}
export function insertContent(nodes, node, parent = 'root', before) {
    const insert = (items) => {
        const copy = [...items];
        const at = before ? copy.findIndex((item) => item.id === before) : -1;
        copy.splice(at < 0 ? copy.length : at, 0, node);
        return copy;
    };
    if (parent === 'root')
        return canInsertBlock(undefined, node) ? insert(nodes) : nodes;
    return updateContent(nodes, parent, (target) => !canInsertBlock(target, node) ? target : { ...target, children: insert(target.children ?? []) });
}
export function moveContent(nodes, id, parent, before) {
    const node = walkContent(nodes).find((item) => item.id === id);
    const target = parent === 'root' ? undefined : walkContent(nodes).find((item) => item.id === parent);
    if (!node || before === id || walkContent([node]).some((item) => item.id === parent))
        return nodes;
    if (!canInsertBlock(target, node))
        return nodes;
    if (parent !== 'root' && (!target || !containerKinds.has(target.kind)))
        return nodes;
    if ((target?.kind === 'columns') !== (node.kind === 'column'))
        return nodes;
    return insertContent(removeContent(nodes, id), node, parent, before);
}
export function duplicateContent(node) {
    return {
        ...structuredClone(node),
        id: `b_${crypto.randomUUID()}`,
        anchor: undefined,
        children: node.children?.map(duplicateContent),
    };
}
export function textDocument(node) {
    const text = (value) => ({
        type: 'text',
        text: value,
        format: 0,
        detail: 0,
        mode: 'normal',
        style: '',
        version: 1,
    });
    const block = {
        type: node.kind === 'heading' ? 'heading' : node.kind === 'quote' ? 'quote' : 'paragraph',
        ...(node.kind === 'heading' ? { tag: `h${node.level ?? 2}` } : {}),
        children: [text(node.text ?? '')],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
    };
    const children = node.kind === 'list'
        ? [
            {
                type: 'list',
                listType: node.ordered ? 'number' : 'bullet',
                tag: node.ordered ? 'ol' : 'ul',
                start: 1,
                direction: null,
                format: '',
                indent: 0,
                version: 1,
                children: (node.text ?? '').split('\n').map((line, index) => ({
                    type: 'listitem',
                    value: index + 1,
                    children: [text(line)],
                    direction: null,
                    format: '',
                    indent: 0,
                    version: 1,
                })),
            },
        ]
        : [block];
    return {
        root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 },
    };
}
export function safeURL(value) {
    if (typeof value !== 'string')
        return '';
    const url = value.trim();
    return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url) ? url : '';
}
const dimensions = /^(-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|auto)(\s+(-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|auto)){0,3}$/;
const colors = /^(#[\da-f]{3,8}|transparent|currentColor|[a-z]+|rgba?\([\d\s.,%]+\)|var\(--[\w-]+\))$/i;
export function validStyleValue(key, value) {
    if (typeof value !== 'string')
        return false;
    const extended = extendedStyleValue(key, value);
    if (extended !== undefined)
        return extended;
    if (dimensionKeys.includes(key))
        return dimensions.test(value);
    if (['backgroundColor', 'color', 'borderColor'].includes(key))
        return colors.test(value);
    if (key === 'textAlign')
        return ['left', 'center', 'right'].includes(value);
    if (key === 'gridTemplateColumns')
        return /^\d+(\.\d+)?fr(\s+\d+(\.\d+)?fr){0,5}$/.test(value);
    return ([
        'padding',
        'margin',
        'width',
        'maxWidth',
        'fontSize',
        'lineHeight',
        'borderWidth',
        'borderRadius',
        'gap',
        'minHeight',
    ].includes(key) && dimensions.test(value));
}
export function validateContentLayout(value, allowedBindingPaths = []) {
    if (value == null)
        return true;
    if (typeof value !== 'object' ||
        value.version !== 1 ||
        !Array.isArray(value.nodes))
        return 'Unsupported content layout.';
    const ids = new Set();
    let count = 0;
    function check(nodes, depth, parent) {
        if (depth > 12)
            return 'Blocks may be nested at most 12 levels.';
        for (const node of nodes) {
            if (!node || typeof node !== 'object' || ++count > 500)
                return 'Invalid block or too many blocks (maximum 500).';
            if (typeof node.id !== 'string' || !/^[\w-]+$/.test(node.id) || ids.has(node.id))
                return 'Block IDs must be unique.';
            ids.add(node.id);
            if (typeof node.kind !== 'string' || !node.kind)
                return 'Missing block type.';
            const presentationError = validatePresentation(node.presentation);
            if (presentationError)
                return presentationError;
            const variationError = validateVariation(node);
            for (const [target, responsive] of Object.entries(node.targetStyles ?? {})) {
                if (getBlockDefinition(node.kind) &&
                    !getBlockDefinition(node.kind)?.targets?.some((item) => item.id === target))
                    return 'Unknown styling target.';
                if (!responsive || typeof responsive !== 'object' || Array.isArray(responsive))
                    return 'Invalid target styles.';
                for (const [device, values] of Object.entries(responsive)) {
                    if (!['desktop', 'tablet', 'mobile'].includes(device) ||
                        !values ||
                        typeof values !== 'object' ||
                        Array.isArray(values))
                        return 'Invalid target device styles.';
                    for (const [key, value] of Object.entries(values))
                        if (!validStyleValue(key, value))
                            return 'Invalid target style.';
                }
            }
            if (variationError)
                return variationError;
            const definition = getBlockDefinition(node.kind);
            if (node.blockVersion !== undefined &&
                (!Number.isInteger(node.blockVersion) || node.blockVersion < 1))
                return 'Invalid block version.';
            const definitionError = definition?.validate?.(node);
            if (definitionError)
                return definitionError;
            for (const [key, field] of Object.entries(node.bindings ?? {}))
                if (field &&
                    (!definition?.fields.some((item) => item.key === key && item.bindable) ||
                        (!publicDocumentFields.includes(field) &&
                            !allowedBindingPaths.includes(field))))
                    return 'Unsupported dynamic field binding.';
            for (const state of ['hover', 'focus'])
                for (const [key, val] of Object.entries(node.presentation?.[state] ?? {}))
                    if (!validStyleValue(key, val))
                        return 'Invalid interaction style.';
            if (node.presentation?.link?.url && !safeURL(node.presentation.link.url))
                return 'Invalid block link URL.';
            if (node.props && (typeof node.props !== 'object' || Array.isArray(node.props)))
                return 'Invalid block properties.';
            for (const field of definition?.fields ?? []) {
                const val = node.props?.[field.key];
                if (val === undefined || val === '')
                    continue;
                if (field.type === 'number' && (typeof val !== 'number' || !Number.isFinite(val)))
                    return `Invalid ${field.label}.`;
                if (field.type === 'number' &&
                    ((field.min !== undefined && Number(val) < field.min) ||
                        (field.max !== undefined && Number(val) > field.max)))
                    return `Invalid ${field.label} range.`;
                if (field.type === 'items' && typeof val !== 'string') {
                    if (!Array.isArray(val) ||
                        val.length > 100 ||
                        val.some((item) => !item ||
                            typeof item !== 'object' ||
                            typeof item.label !== 'string' ||
                            (item.url && !safeURL(item.url)) ||
                            (item.icon && typeof item.icon !== 'string')))
                        return 'Invalid list items.';
                }
                if (!['number', 'toggle', 'items'].includes(field.type) && typeof val !== 'string')
                    return `Invalid ${field.label}.`;
                if (field.type === 'date' &&
                    (!Number.isFinite(Date.parse(String(val))) || !/(Z|[+-]\d\d:\d\d)$/.test(String(val))))
                    return 'Dates must include a timezone.';
                if (field.type === 'toggle' && typeof val !== 'boolean')
                    return `Invalid ${field.label}.`;
                if (field.type === 'select' && !field.options?.includes(String(val)))
                    return `Invalid ${field.label}.`;
                if (field.type === 'url' && !safeURL(val))
                    return `Invalid ${field.label}.`;
            }
            if ((parent?.kind === 'columns') !== (node.kind === 'column'))
                return 'Columns must contain column blocks, and column blocks must be inside Columns.';
            if (definition?.allowedParents && !definition.allowedParents.includes(parent?.kind ?? 'root'))
                return 'Block is not allowed in this container.';
            const parentDefinition = parent && getBlockDefinition(parent.kind);
            if (parentDefinition?.canContain && !parentDefinition.canContain(parent, node))
                return 'Block is not allowed in this container.';
            if (node.binding)
                return 'Freeform blocks cannot declare template field bindings.';
            for (const key of ['text', 'label', 'alt', 'url', 'anchor'])
                if (node[key] !== undefined && typeof node[key] !== 'string')
                    return `Invalid ${key} on block ${node.id}.`;
            if (node.richText != null &&
                (typeof node.richText !== 'object' || !('root' in node.richText)))
                return `Invalid rich text on block ${node.id}.`;
            if (node.anchor && !/^[a-zA-Z][\w-]*$/.test(node.anchor))
                return 'Anchors must start with a letter and contain only letters, numbers, dashes or underscores.';
            if (node.url && !safeURL(node.url))
                return 'Use a valid link URL.';
            if (node.level && ![1, 2, 3, 4, 5, 6].includes(node.level))
                return 'Invalid heading level.';
            for (const [device, styles] of Object.entries(node.styles ?? {})) {
                if (!['desktop', 'tablet', 'mobile'].includes(device) ||
                    !styles ||
                    typeof styles !== 'object')
                    return 'Invalid responsive style.';
                for (const [key, val] of Object.entries(styles))
                    if (!validStyleValue(key, val))
                        return `Invalid ${key} style on ${node.label ?? node.kind}.`;
            }
            if (node.children) {
                if (!Array.isArray(node.children) || (definition && !containerKinds.has(node.kind)))
                    return 'Only layout blocks can contain children.';
                const error = check(node.children, depth + 1, node);
                if (error)
                    return error;
            }
        }
    }
    return check(value.nodes, 0) ?? true;
}
export function resolveStyle(style, viewport = 'desktop') {
    const result = {};
    for (const device of (viewport === 'mobile'
        ? ['desktop', 'tablet', 'mobile']
        : viewport === 'tablet'
            ? ['desktop', 'tablet']
            : ['desktop'])) {
        const layer = style?.[device];
        if (!layer)
            continue;
        for (const key of ['padding', 'margin']) {
            if (!Object.values(style ?? {}).some((layer) => ['Top', 'Right', 'Bottom', 'Left'].some((side) => layer?.[key + side] !== undefined)))
                continue;
            if (layer[key] !== undefined) {
                const p = layer[key].trim().split(/\s+/);
                const sides = [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]];
                ['Top', 'Right', 'Bottom', 'Left'].forEach((side, i) => {
                    result[key + side] = sides[i];
                });
            }
        }
        Object.assign(result, layer);
    }
    for (const key of ['padding', 'margin'])
        if (['Top', 'Right', 'Bottom', 'Left'].some((side) => result[key + side] !== undefined))
            delete result[key];
    return result;
}
export function templateStyle(style) {
    const spacing = { none: '0', small: '8px', medium: '16px', large: '32px' };
    const background = {
        transparent: 'transparent',
        surface: 'var(--theme-bg)',
        muted: '#f5f5f5',
        accent: 'var(--color-accent)',
    };
    return {
        desktop: {
            ...(style?.spacing ? { padding: spacing[style.spacing] } : {}),
            ...(style?.alignment ? { textAlign: style.alignment } : {}),
            ...(style?.background ? { backgroundColor: background[style.background] } : {}),
            ...(style?.fontSize
                ? {
                    fontSize: { small: '14px', medium: '16px', large: '24px', xlarge: '36px' }[style.fontSize],
                }
                : {}),
            ...(style?.textColor
                ? {
                    color: {
                        default: 'inherit',
                        muted: '#666666',
                        accent: 'var(--color-accent)',
                        inverse: '#ffffff',
                    }[style.textColor],
                }
                : {}),
            ...(style?.width
                ? {
                    maxWidth: { content: '760px', wide: '1200px', full: '100%' }[style.width],
                    width: '100%',
                }
                : {}),
            ...style?.responsive?.desktop,
        },
        tablet: style?.responsive?.tablet,
        mobile: style?.responsive?.mobile,
    };
}
