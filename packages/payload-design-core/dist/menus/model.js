export function safeMenuURL(value) {
    if (typeof value !== 'string' || !value || /[\s\u0000-\u001f\u007f\\]/.test(value))
        return false;
    if (value.startsWith('/') && !value.startsWith('//'))
        return true;
    if (/^#[^#]+$/.test(value))
        return true;
    if (/^(mailto:[^@]+@[^@]+|tel:\+?[0-9().-]+)$/i.test(value))
        return true;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    }
    catch {
        return false;
    }
}
export function validateMenuItems(value) {
    if (!Array.isArray(value) || value.length > 500)
        return 'Use an array of up to 500 menu items.';
    const items = value, byID = new Map();
    for (const item of items) {
        if (!item ||
            typeof item.key !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(item.key) ||
            byID.has(item.key))
            return 'Every item needs a unique stable identifier.';
        byID.set(item.key, item);
        if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200)
            return 'Enter an item label of up to 200 characters.';
        if (!['page', 'post', 'custom'].includes(item.kind))
            return 'Choose a supported menu item type.';
        if (item.kind === 'custom'
            ? !safeMenuURL(item.url)
            : item.target != null && (!Number.isSafeInteger(item.target) || Number(item.target) <= 0))
            return 'Choose a destination or enter a safe link URL.';
        if ((item.enabled !== undefined && typeof item.enabled !== 'boolean') ||
            (item.newTab !== undefined && typeof item.newTab !== 'boolean'))
            return 'Invalid item settings.';
    }
    for (const item of items) {
        const seen = new Set([item.key]);
        let parent = item.parent;
        let depth = 1;
        while (parent) {
            const ancestor = byID.get(parent);
            if (!ancestor)
                return 'A parent item no longer exists.';
            if (seen.has(parent))
                return 'Menu items cannot contain cycles.';
            seen.add(parent);
            parent = ancestor.parent;
            if (++depth > 5)
                return 'Menus support up to five levels.';
        }
    }
    return true;
}
export function orderedMenu(items) {
    const result = [];
    const visit = (parent) => items
        .filter((item) => (item.parent || null) === parent)
        .forEach((item) => {
        result.push(item);
        visit(item.key);
    });
    visit(null);
    return result;
}
export function menuDepth(items, key) {
    let item = items.find((value) => value.key === key), depth = 0;
    const seen = new Set();
    while (item && !seen.has(item.key)) {
        seen.add(item.key);
        depth++;
        item = items.find((value) => value.key === item.parent);
    }
    return depth;
}
export function moveMenuBranch(items, key, parent, before) {
    const next = items.map((item) => (item.key === key ? { ...item, parent } : { ...item }));
    const moving = next.find((item) => item.key === key);
    if (!moving)
        return items;
    const others = next.filter((item) => item.key !== key);
    const index = before ? others.findIndex((item) => item.key === before) : -1;
    others.splice(index < 0 ? others.length : index, 0, moving);
    return validateMenuItems(others) === true ? orderedMenu(others) : items;
}
export function removeMenuItem(items, key, branch) {
    const parent = items.find((item) => item.key === key)?.parent || null;
    const removed = new Set([key]);
    if (branch) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const item of items)
                if (item.parent && removed.has(item.parent) && !removed.has(item.key)) {
                    removed.add(item.key);
                    changed = true;
                }
        }
    }
    return items
        .filter((item) => !removed.has(item.key))
        .map((item) => (item.parent === key ? { ...item, parent } : item));
}
