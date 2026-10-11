import { templateBlockValue, shellBlockValue } from '../blocks/adapters.js';
import { getBlockDefinition } from '../blocks/registry.js';
export const flattenSidebar = (nodes) => nodes.flatMap((node) => [node, ...flattenSidebar(node.children ?? [])]);
export function locateSidebar(nodes, id, parent = 'root') {
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (node.id === id)
            return { node, parent, siblings: nodes, index };
        const nested = locateSidebar(node.children ?? [], id, node.id);
        if (nested)
            return nested;
    }
}
export function insertionTarget(nodes, selected) {
    const found = selected ? locateSidebar(nodes, selected) : undefined;
    if (!found)
        return { parent: 'root' };
    if (found.node.ownerID)
        return insertionTarget(nodes, found.node.ownerID);
    if (found.node.kind === 'columns' && found.node.children?.length)
        return { parent: found.node.children[found.node.children.length - 1].id };
    if (found.node.container)
        return { parent: found.node.id };
    return { parent: found.parent, before: found.siblings[found.index + 1]?.id };
}
export function outlineSummary(nodes) {
    const all = flattenSidebar(nodes);
    const text = all
        .map((node) => node.text ?? '')
        .join(' ')
        .trim();
    const words = text ? text.split(/\s+/u).length : 0;
    return {
        headings: all.filter((node) => node.heading && node.text?.trim()),
        words,
        minutes: Math.ceil(words / 200),
    };
}
function lexicalRows(value, ownerID) {
    if (!value || typeof value !== 'object')
        return [];
    const root = value.root;
    const text = (node) => node.text ?? (node.children ?? []).map(text).join('');
    const visit = (node, path) => {
        if (['paragraph', 'heading', 'quote', 'listitem'].includes(node.type ?? '')) {
            const nested = (node.children ?? []).filter((child) => child.type === 'list');
            const ownText = (node.children ?? [])
                .filter((child) => child.type !== 'list')
                .map(text)
                .join('');
            return [
                {
                    id: `${ownerID}:text:${path}`,
                    ownerID,
                    kind: node.type,
                    label: ownText || node.type,
                    text: ownText,
                    heading: node.type === 'heading' ? Number(node.tag?.slice(1) || 2) : undefined,
                    children: nested.flatMap((child, i) => visit(child, `${path}-${i}`)),
                },
            ];
        }
        return (node.children ?? []).flatMap((child, i) => visit(child, `${path}-${i}`));
    };
    return root ? visit(root, 'root') : [];
}
const label = (kind) => kind.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
export function contentSidebarNodes(nodes) {
    return nodes.map((node) => {
        if (node.kind === 'designed' && node.rendererKey === 'hero-board') {
            const values = node.values ?? {};
            const textFields = ['eyebrow', 'headline', 'subheadline'].flatMap((key) => typeof values[key] === 'string' && values[key]
                ? [
                    {
                        id: `${node.id}:value:${key}`,
                        ownerID: node.id,
                        kind: key === 'headline' ? 'heading' : 'paragraph',
                        label: String(values[key]),
                        text: String(values[key]),
                        heading: key === 'headline' ? 2 : undefined,
                    },
                ]
                : []);
            for (const key of ['primaryCTA', 'secondaryCTA']) {
                const text = values[key]?.label;
                if (typeof text === 'string')
                    textFields.push({
                        id: `${node.id}:value:${key}`,
                        ownerID: node.id,
                        kind: 'button',
                        label: text,
                        text,
                        heading: undefined,
                    });
            }
            return {
                id: node.id,
                kind: node.kind,
                label: node.label || 'Designed block',
                children: textFields,
            };
        }
        const rich = lexicalRows(node.richText, node.id);
        const list = node.kind === 'list' && !rich.length
            ? (node.text ?? '')
                .split('\n')
                .filter(Boolean)
                .map((text, i) => ({
                id: `${node.id}:item:${i}`,
                ownerID: node.id,
                label: text,
                text,
                kind: 'listitem',
            }))
            : [];
        return {
            id: node.id,
            kind: node.kind,
            label: node.label || label(node.kind),
            container: !!getBlockDefinition(node.kind)?.container && node.kind !== 'columns',
            children: [...contentSidebarNodes(node.children ?? []), ...rich, ...list],
            text: rich.length || list.length ? undefined : node.text ?? getBlockDefinition(node.kind)?.outline?.(node) ?? ['text', 'label', 'items'].map(key => typeof node.props?.[key] === 'string' ? node.props[key] : '').filter(Boolean).join(' '),
            heading: node.kind === 'heading' && !rich.length ? (node.level ?? 2) : undefined,
        };
    });
}
export function templateSidebarNodes(nodes) {
    return nodes.map((node) => {
        const block = templateBlockValue(node);
        if (block)
            return contentSidebarNodes([block])[0];
        if (node.type === 'layout')
            return {
                id: node.id,
                kind: node.layout,
                label: label(node.layout),
                container: ['container', 'row', 'stack'].includes(node.layout),
                children: node.layout === 'columns'
                    ? node.columns?.map((column, i) => ({
                        id: column.id,
                        kind: 'column',
                        label: `Column ${i + 1}`,
                        container: true,
                        immovable: true,
                        children: templateSidebarNodes(column.children),
                    }))
                    : templateSidebarNodes(node.children ?? []),
            };
        if (node.type === 'block')
            return { id: node.id, kind: 'designed', label: node.name };
        const value = node.content?.source === 'static' ? node.content.value : undefined;
        const rich = node.fieldType === 'richText' ? lexicalRows(value, node.id) : [];
        return {
            id: node.id,
            kind: node.fieldType,
            label: node.label,
            text: typeof value === 'string' ? value : undefined,
            heading: node.fieldType === 'shortText' ? 2 : undefined,
            children: rich,
        };
    });
}
export function shellSidebarNodes(nodes) {
    return nodes.map((node) => {
        const block = shellBlockValue(node);
        if (block)
            return contentSidebarNodes([block])[0];
        if (node.type === 'layout')
            return {
                id: node.id,
                kind: node.layout,
                label: label(node.layout),
                container: ['container', 'row', 'stack'].includes(node.layout),
                children: node.layout === 'columns'
                    ? node.columns?.map((column, i) => ({
                        id: column.id,
                        kind: 'column',
                        label: `Column ${i + 1}`,
                        container: true,
                        immovable: true,
                        children: shellSidebarNodes(column.children),
                    }))
                    : shellSidebarNodes(node.children ?? []),
            };
        const rich = lexicalRows(node.props?.lexical, node.id);
        const text = ['text', 'button', 'copyright'].includes(node.element)
            ? (node.props?.text ?? node.props?.label)
            : undefined;
        return {
            id: node.id,
            kind: node.element,
            label: label(node.element),
            text: typeof text === 'string' ? text : undefined,
            children: rich,
        };
    });
}
/** Copies structural IDs only; custom-field references remain shared by template design. */
export function duplicateBuilderNode(node) {
    const copy = structuredClone(node);
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return;
        const record = value;
        if (typeof record.id === 'string')
            record.id = `block_${crypto.randomUUID()}`;
        if (record.block && typeof record.block === 'object')
            record.block.id = record.id;
        if (record.style && typeof record.style === 'object')
            delete record.style.anchor;
        for (const key of ['children', 'columns'])
            if (Array.isArray(record[key]))
                record[key].forEach(visit);
    };
    visit(copy);
    return copy;
}
