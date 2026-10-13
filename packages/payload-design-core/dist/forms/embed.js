/** Exact origins only: never turn paths, wildcards, credentials, or opaque URLs into CSP sources. */
export function embedOrigin(value) {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.includes('*'))
            return undefined;
        if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])$/i.test(url.hostname))
            return undefined;
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
            return undefined;
        return url.origin;
    }
    catch {
        return undefined;
    }
}
export function resizeHeight(data, id) {
    if (!data || typeof data !== 'object')
        return undefined;
    const value = data;
    if (value.type !== 'vorti-form-resize' || value.id !== id || typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height < 1 || value.height > 100000)
        return undefined;
    return Math.max(100, Math.min(20000, Math.ceil(value.height)));
}
