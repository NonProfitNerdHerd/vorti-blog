import { jsx as _jsx } from "react/jsx-runtime";
import { DynamicView } from './DynamicView.js';
import { SiteAnchor } from '../PublicSiteContext.js';
function linkHref(node) {
    if (node.fields.linkType !== 'internal')
        return node.fields.url || '#';
    const reference = node.fields.doc;
    const value = reference?.value;
    if (!value || typeof value !== 'object' || typeof value.slug !== 'string')
        return '#';
    return (reference.relationTo === 'posts' ? '/posts/' : '/') + value.slug;
}
export const savedViewConverters = ({ defaultConverters }) => ({
    ...defaultConverters,
    link: ({ node, nodesToJSX }) => (_jsx(SiteAnchor, { href: linkHref(node), target: node.fields.newTab ? '_blank' : undefined, rel: node.fields.newTab ? 'noopener noreferrer' : undefined, children: nodesToJSX({ nodes: node.children }) })),
    autolink: ({ node, nodesToJSX }) => (_jsx(SiteAnchor, { href: node.fields.url || '#', target: node.fields.newTab ? '_blank' : undefined, rel: node.fields.newTab ? 'noopener noreferrer' : undefined, children: nodesToJSX({ nodes: node.children }) })),
    blocks: {
        savedViewEmbed: ({ node }) => {
            const fields = node.fields;
            const ref = fields.viewID;
            const id = ref && typeof ref === 'object' ? ('id' in ref ? ref.id : undefined) : ref;
            return (_jsx(DynamicView, { viewID: typeof id === 'string' || typeof id === 'number' ? id : undefined }));
        },
    },
});
