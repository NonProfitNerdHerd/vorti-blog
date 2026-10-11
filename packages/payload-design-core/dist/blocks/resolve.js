import { conditionVisible, publicDocumentFields, readPublicDocumentField } from './presentation.js';
import { getBlockDefinition } from './registry.js';
import { walkContent } from '../content/model.js';
export async function resolveBlocks(source, context) {
    const resolve = async (items) => {
        const result = [];
        for (const stored of items) {
            const original = structuredClone(stored);
            const definition = getBlockDefinition(original.kind);
            const node = definition?.upgrade && (original.blockVersion ?? 1) < definition.version
                ? definition.upgrade(original)
                : original;
            const visible = conditionVisible(node.presentation?.condition, context.document, context.now);
            if (!visible && !context.preview)
                continue;
            for (const [key, field] of Object.entries(node.bindings ?? {})) {
                if (!definition?.fields.some((item) => item.key === key && item.bindable) ||
                    !publicDocumentFields.includes(field))
                    continue;
                node.props = { ...node.props, [key]: readPublicDocumentField(context.document, field) };
            }
            if (node.children)
                node.children = await resolve(node.children);
            if (node.kind === 'postListing' && context.list)
                node.props = { ...node.props, ...(await context.list(node.props ?? {}, 1)) };
            result.push(node);
        }
        return result;
    };
    const result = await resolve(source);
    const headings = [];
    for (const node of walkContent(result)) {
        if (node.kind === 'heading' && node.text) {
            node.anchor ||= `heading-${node.id}`;
            headings.push({ id: node.anchor, text: node.text, level: node.level ?? 2 });
        }
        if (node.richText && typeof node.richText === 'object') {
            let headingIndex = 0;
            const visit = (value) => {
                if (value.type === 'heading') {
                    const anchor = `heading-${node.id}-${++headingIndex}`;
                    const text = (children) => children
                        .map((raw) => {
                        const child = raw;
                        return typeof child.text === 'string'
                            ? child.text
                            : text(Array.isArray(child.children) ? child.children : []);
                    })
                        .join('');
                    headings.push({
                        id: anchor,
                        text: text(Array.isArray(value.children) ? value.children : []),
                        level: Number(String(value.tag ?? 'h2').slice(1)),
                    });
                }
                for (const child of Array.isArray(value.children) ? value.children : [])
                    visit(child);
            };
            const root = node.richText.root;
            if (root)
                visit(root);
        }
    }
    for (const node of walkContent(result))
        if (node.kind === 'tableOfContents')
            node.props = {
                ...node.props,
                headings: headings.filter((heading) => heading.level >= Number(node.props?.minLevel ?? 2) &&
                    heading.level <= Number(node.props?.maxLevel ?? 6)),
            };
    return result;
}
