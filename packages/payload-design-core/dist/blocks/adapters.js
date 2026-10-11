import { canInsertBlock } from './registry.js';
import { templateStyle } from '../content/model.js';
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
    const value = (node) => node.type === 'layout' && node.block ? { ...node.block, id: node.id } : { id: node.id, kind: node.type === 'layout' ? 'group' : 'paragraph' };
    return canInsertBlock(parent ? value(parent) : root ? undefined : { id: 'column', kind: 'group' }, value(child));
}
