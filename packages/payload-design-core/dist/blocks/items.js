export function blockItems(value, social = false) {
    if (Array.isArray(value))
        return value;
    return String(value ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
        const [label, url] = social ? line.split('|').map((value) => value.trim()) : [line];
        return { label, ...(url ? { url } : {}) };
    });
}
