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
export const containerKinds = new Set(['group', 'row', 'columns', 'column']);
export function createContentNode(kind) {
    const node = {
        id: `b_${crypto.randomUUID()}`,
        kind,
        label: contentLibrary.find((item) => item.kind === kind)?.label ?? kind,
    };
    if (containerKinds.has(kind))
        node.children =
            kind === 'columns' ? [createContentNode('column'), createContentNode('column')] : [];
    if (kind === 'columns')
        node.styles = { tablet: { gridTemplateColumns: '1fr' } };
    if (kind === 'heading')
        node.level = 2;
    if (kind === 'spacer')
        node.styles = { desktop: { minHeight: '32px' } };
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
        return node.kind === 'column' ? nodes : insert(nodes);
    return updateContent(nodes, parent, (target) => !containerKinds.has(target.kind) || (target.kind === 'columns') !== (node.kind === 'column')
        ? target
        : { ...target, children: insert(target.children ?? []) });
}
export function moveContent(nodes, id, parent, before) {
    const node = walkContent(nodes).find((item) => item.id === id);
    const target = parent === 'root' ? undefined : walkContent(nodes).find((item) => item.id === parent);
    if (!node || before === id || walkContent([node]).some((item) => item.id === parent))
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
export function validateContentLayout(value) {
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
            if (![...contentLibrary.map((item) => item.kind), 'column', 'designed'].includes(node.kind))
                return 'Unknown block type.';
            if ((parent === 'columns') !== (node.kind === 'column'))
                return 'Columns must contain column blocks, and column blocks must be inside Columns.';
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
                if (!Array.isArray(node.children) || !containerKinds.has(node.kind))
                    return 'Only layout blocks can contain children.';
                const error = check(node.children, depth + 1, node.kind);
                if (error)
                    return error;
            }
        }
    }
    return check(value.nodes, 0) ?? true;
}
export function resolveStyle(style, viewport = 'desktop') {
    return {
        ...style?.desktop,
        ...(viewport !== 'desktop' ? style?.tablet : {}),
        ...(viewport === 'mobile' ? style?.mobile : {}),
    };
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
