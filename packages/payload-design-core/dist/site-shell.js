export const SITE_SHELL_LAYOUT_KINDS = ['container', 'row', 'columns', 'stack', 'spacer', 'divider'];
export const SITE_SHELL_ELEMENT_KINDS = [
    'logo',
    'siteName',
    'navigation',
    'button',
    'search',
    'text',
    'richText',
    'icon',
    'image',
    'socialLinks',
    'mobileMenuToggle',
    'copyright',
    'currentYear',
];
export const ADDITIONAL_CSS_MAX_LENGTH = 50_000;
export function validateAdditionalCSS(value) {
    if (value == null || value === '')
        return true;
    if (typeof value !== 'string')
        return 'Additional CSS must be text.';
    if (value.length > ADDITIONAL_CSS_MAX_LENGTH)
        return `Additional CSS cannot exceed ${ADDITIONAL_CSS_MAX_LENGTH} characters.`;
    if (/<\s*\/\s*style\b/i.test(value))
        return 'Additional CSS cannot close a style element.';
    if (/@import\b/i.test(value))
        return 'Additional CSS cannot use @import.';
    return true;
}
export function validateSiteShellNodes(value) {
    if (!Array.isArray(value))
        return 'Site Shell layout must be an array.';
    const ids = new Set();
    const error = validateNodes(value, ids);
    return error ?? true;
}
function validateNodes(nodes, ids) {
    for (const raw of nodes) {
        if (!raw || typeof raw !== 'object')
            return 'Every Site Shell node must be an object.';
        const node = raw;
        if (typeof node.id !== 'string' || !node.id.trim())
            return 'Every Site Shell node requires a stable id.';
        if (ids.has(node.id))
            return `Site Shell node id "${node.id}" is duplicated.`;
        ids.add(node.id);
        if (node.type === 'element') {
            if (!SITE_SHELL_ELEMENT_KINDS.includes(node.element))
                return `Unsupported Site Shell element "${String(node.element)}".`;
            continue;
        }
        if (node.type !== 'layout')
            return `Unsupported Site Shell node type "${String(node.type)}".`;
        if (!SITE_SHELL_LAYOUT_KINDS.includes(node.layout))
            return `Unsupported Site Shell layout "${String(node.layout)}".`;
        const children = node.children ?? [];
        if (!Array.isArray(children))
            return `Layout node "${node.id}" has invalid children.`;
        const childError = validateNodes(children, ids);
        if (childError)
            return childError;
        const columns = node.columns ?? [];
        if (!Array.isArray(columns))
            return `Layout node "${node.id}" has invalid columns.`;
        if (node.layout === 'columns' && columns.length === 0)
            return `Columns node "${node.id}" requires at least one column.`;
        if (node.layout !== 'columns' && columns.length > 0)
            return `Only columns nodes may contain columns.`;
        let width = 0;
        for (const rawColumn of columns) {
            if (!rawColumn || typeof rawColumn !== 'object')
                return `Columns node "${node.id}" contains an invalid column.`;
            const column = rawColumn;
            if (typeof column.id !== 'string' || !column.id.trim())
                return `Every Site Shell column requires a stable id.`;
            if (ids.has(column.id))
                return `Site Shell node id "${column.id}" is duplicated.`;
            ids.add(column.id);
            if (typeof column.width !== 'number' || column.width <= 0)
                return `Column "${column.id}" requires a positive width.`;
            width += column.width;
            if (!Array.isArray(column.children))
                return `Column "${column.id}" has invalid children.`;
            const columnError = validateNodes(column.children, ids);
            if (columnError)
                return columnError;
        }
        if (columns.length > 0 && Math.abs(width - 100) > 0.01)
            return `Columns node "${node.id}" widths must total 100.`;
    }
}
