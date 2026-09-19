function available(item, mode) {
    return !!item && (mode === 'draft' || (item.status === 'published' && item._status === 'published'));
}
export async function resolveBlockDesign(store, id, mode = 'published') {
    const design = await store.getBlockDesign(id, mode);
    if (!available(design, mode) || !design)
        throw new Error(`Block Design ${id} is unavailable`);
    const blockType = await store.getBlockType(design.blockType, mode);
    if (!available(blockType, mode) || !blockType)
        throw new Error(`Block Type ${design.blockType} is unavailable`);
    return { blockDesign: design, blockType };
}
export async function resolveTemplate(store, id, mode = 'published') {
    const template = await store.getTemplate(id, mode);
    if (!available(template, mode) || !template)
        throw new Error(`Template ${id} is unavailable`);
    const sections = await Promise.all(template.sections.map(async (section) => {
        const selected = await resolveBlockDesign(store, section.blockDesign, mode);
        if (String(selected.blockType.id) !== String(section.blockType))
            throw new Error(`Default design for ${section.key} must belong to its Block Type`);
        return { key: section.key, name: section.name, required: !!section.required,
            allowDesignOverride: !!section.allowDesignOverride, ...selected };
    }));
    return { template, sections };
}
export async function resolveContentTemplate(store, content, mode = 'published') {
    const resolved = await resolveTemplate(store, content.template, mode);
    const sections = await Promise.all(resolved.sections.map(async (section) => {
        const override = content.designOverrides?.[section.key];
        if (!override)
            return { ...section, values: (content.templateValues?.[section.key] ?? {}) };
        if (!section.allowDesignOverride)
            throw new Error(`Design override is not allowed for ${section.key}`);
        const selected = await resolveBlockDesign(store, override, mode);
        if (String(selected.blockType.id) !== String(section.blockType.id))
            throw new Error(`Design override for ${section.key} must use the same Block Type`);
        return { ...section, ...selected, values: (content.templateValues?.[section.key] ?? {}) };
    }));
    const layout = resolved.template.layout ?? [];
    const blockNodes = [];
    const visit = (nodes) => nodes.forEach((node) => {
        if (node.type === 'block')
            blockNodes.push(node);
        if (node.type === 'layout') {
            visit(node.children ?? []);
            for (const column of node.columns ?? [])
                visit(column.children);
        }
    });
    visit(layout);
    const blocks = await Promise.all(blockNodes.map(async (node) => {
        const override = content.designOverrides?.[node.id];
        const selected = await resolveBlockDesign(store, override && node.allowDesignOverride ? override : node.blockDesign, mode);
        if (String(selected.blockType.id) !== String(node.blockType))
            throw new Error(`Default design for ${node.name} must belong to its Block Type`);
        return { ...node, blockTypeDoc: selected.blockType, blockDesignDoc: selected.blockDesign, values: content.templateValues ?? {} };
    }));
    return {
        contentId: content.id,
        template: resolved.template,
        sections,
        layout,
        blocks,
    };
}
