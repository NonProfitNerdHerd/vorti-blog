export function exportBlockDesign(design, blockTypeSlug) {
    const { id: _id, blockType: _blockType, ...portable } = design;
    return { schemaVersion: 1, kind: 'block-design', item: { ...portable, blockTypeSlug }, dependencies: [blockTypeSlug] };
}
export function exportTemplate(template, designSlugs) {
    const { id: _id, sections, ...portable } = template;
    const resolved = sections.map(({ blockDesign, ...section }) => {
        const blockDesignSlug = designSlugs[String(blockDesign)];
        if (!blockDesignSlug)
            throw new Error(`Missing design slug for ${blockDesign}`);
        return { ...section, blockDesignSlug };
    });
    return { schemaVersion: 1, kind: 'template', item: { ...portable, sections: resolved }, dependencies: [...new Set(resolved.map((section) => section.blockDesignSlug))] };
}
export function validateExport(value) {
    if (!value || typeof value !== 'object')
        return false;
    const item = value;
    return item.schemaVersion === 1 && (item.kind === 'block-design' || item.kind === 'template') && !!item.item && Array.isArray(item.dependencies) && item.dependencies.every((dependency) => typeof dependency === 'string');
}
