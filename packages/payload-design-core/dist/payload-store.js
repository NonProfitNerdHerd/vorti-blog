import { slugs } from './types.js';
import { walkTemplate } from './template-tree.js';
export function createPayloadDesignStore(payload, req) {
    async function get(collection, id, mode) {
        try {
            return await payload.findByID({ collection: collection, id, depth: 0, draft: mode === 'draft', overrideAccess: false, req });
        }
        catch {
            return null;
        }
    }
    return {
        getTemplate: (id, mode) => get(slugs.templates, id, mode),
        getBlockDesign: (id, mode) => get(slugs.blockDesigns, id, mode),
        getBlockType: (id, mode) => get(slugs.blockTypes, id, mode),
    };
}
export function createPayloadDependencySource(payload, contentCollections, req) {
    return {
        async templatesUsingDesign(id) {
            const result = await payload.find({ collection: slugs.templates, depth: 0, limit: 1000, pagination: false, overrideAccess: true, req });
            return result.docs.filter((doc) => {
                const template = doc;
                const legacyMatch = template.sections?.some((section) => String(typeof section.blockDesign === 'object' ? section.blockDesign.id : section.blockDesign) === String(id));
                let layoutMatch = false;
                walkTemplate(template.layout ?? [], (node) => {
                    if (node.type === 'block' && String(typeof node.blockDesign === 'object' ? node.blockDesign.id : node.blockDesign) === String(id))
                        layoutMatch = true;
                });
                return legacyMatch || layoutMatch;
            }).map((doc) => ({ id: doc.id, name: String(doc.name) }));
        },
        async contentUsingTemplate(id) {
            const results = await Promise.all(contentCollections.map(async (collection) => {
                const result = await payload.find({ collection: collection, where: { designTemplate: { equals: id } }, depth: 0, limit: 1000, pagination: false, overrideAccess: true, req });
                return result.docs.map((doc) => ({ collection, id: doc.id, status: doc._status }));
            }));
            return results.flat();
        },
    };
}
