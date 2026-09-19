export function createBlockRegistry(entries = []) {
    const registered = new Map();
    for (const entry of entries) {
        if (registered.has(entry.slug))
            throw new Error(`Duplicate block type: ${entry.slug}`);
        registered.set(entry.slug, entry);
    }
    return {
        get: (slug) => registered.get(slug),
        list: () => [...registered.values()],
    };
}
export function createRendererRegistry(entries) {
    return {
        get(key) {
            const component = entries[key];
            if (!component)
                throw new Error(`No trusted renderer registered for ${key}`);
            return component;
        },
        keys: () => Object.keys(entries),
    };
}
