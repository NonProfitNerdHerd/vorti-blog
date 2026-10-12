import { canInsertBlock } from './registry.js';
import { templateStyle } from '../content/model.js';
import { resolveDocumentHeadings } from './resolve.js';
export function adapterPreviewNodes(nodes) {
    const convert = (items) => items.map((node) => node.type === 'layout'
        ? {
            ...(node.block ?? { kind: 'group' }),
            id: node.id,
            children: convert([
                ...(node.children ?? []),
                ...(node.columns ?? []).flatMap((column) => column.children ?? []),
            ]),
        }
        : node.type === 'field'
            ? {
                id: node.id,
                kind: node.fieldType === 'shortText' ? 'heading' : 'paragraph',
                text: node.content?.source === 'static' ? node.content.value : '',
            }
            : { id: node.id, kind: 'group' });
    return resolveDocumentHeadings(convert(nodes));
}
export function adapterListings(nodes) {
    return nodes.flatMap((node) => [
        ...(node.type === 'layout' && node.block?.kind === 'postListing'
            ? [{ id: node.id, label: node.block.label ?? 'Listing' }]
            : []),
        ...(node.type === 'layout' ? adapterListings(node.children ?? []) : []),
        ...(node.type === 'layout'
            ? (node.columns ?? []).flatMap((column) => adapterListings(column.children ?? []))
            : []),
    ]);
}
/** The wrapper preserves existing tree/storage paths; block contains only this node's values. */
export function toTemplateBlock(node) {
    const { children, ...block } = node;
    return {
        id: node.id,
        type: 'layout',
        layout: 'container',
        block,
        children: children?.map(toTemplateBlock),
    };
}
export function toShellBlock(node) {
    const { children, ...block } = node;
    return {
        id: node.id,
        type: 'layout',
        layout: 'container',
        block,
        children: children?.map(toShellBlock),
    };
}
export function mergeTemplateBlock(original, node) {
    if (original.type !== 'layout' || !original.block)
        return original;
    const { children, ...block } = node;
    return {
        ...original,
        block,
        children: children?.map((child) => {
            const previous = original.children?.find((item) => item.id === child.id);
            return previous ? mergeTemplateBlock(previous, child) : toTemplateBlock(child);
        }),
    };
}
export function mergeShellBlock(original, node) {
    if (original.type !== 'layout' || !original.block)
        return original;
    const { children, ...block } = node;
    return {
        ...original,
        block,
        children: children?.map((child) => {
            const previous = original.children?.find((item) => item.id === child.id);
            return previous ? mergeShellBlock(previous, child) : toShellBlock(child);
        }),
    };
}
export function templateBlockValue(node) {
    if (node.type !== 'layout' || !node.block)
        return undefined;
    return {
        ...node.block,
        id: node.id,
        children: node.children?.map((child) => templateBlockValue(child) ??
            (child.type === 'field'
                ? {
                    id: child.id,
                    kind: child.fieldType === 'shortText' ? 'heading' : 'paragraph',
                    text: child.content?.source === 'static' ? child.content.value : '',
                    styles: templateStyle(child.style),
                }
                : { id: child.id, kind: 'group' })),
    };
}
export function shellBlockValue(node) {
    if (node.type !== 'layout' || !node.block)
        return undefined;
    return {
        ...node.block,
        id: node.id,
        children: node.children?.map((child) => shellBlockValue(child) ?? {
            id: child.id,
            kind: child.type === 'element' ? child.element : 'group',
            props: child.type === 'element' ? child.props : undefined,
        }),
    };
}
export function canInsertAdapterNode(parent, child, root = false) {
    const value = (node) => node.type === 'layout' && node.block
        ? { ...node.block, id: node.id }
        : { id: node.id, kind: node.type === 'layout' ? 'group' : 'paragraph' };
    return canInsertBlock(parent ? value(parent) : root ? undefined : { id: 'column', kind: 'group' }, value(child));
}
