'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, } from 'react';
const PublicSiteContext = createContext({ prefix: '', preview: false });
export function PublicSiteProvider({ prefix, preview = false, children, }) {
    return (_jsx(PublicSiteContext.Provider, { value: { prefix, preview }, children: children }));
}
export function sitePath(prefix, path) {
    if (!prefix ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.startsWith('/sites/') ||
        /^\/(?:_next|forms-assets)(?:\/|$)/.test(path))
        return path;
    return prefix + path;
}
export function usePublicSitePath() {
    const { prefix, preview } = useContext(PublicSiteContext);
    return useCallback((path) => {
        const result = sitePath(prefix, path);
        if (!preview || !result.startsWith(prefix + '/') || result.includes('preview=1'))
            return result;
        const [url, hash] = result.split('#');
        return url + (url.includes('?') ? '&' : '?') + 'preview=1' + (hash ? '#' + hash : '');
    }, [prefix, preview]);
}
export function SiteAnchor({ href, ...props }) {
    const path = usePublicSitePath();
    return _jsx("a", { ...props, href: href ? path(href) : href });
}
export function usePublicFetch() {
    const path = usePublicSitePath();
    return useCallback((url, options) => {
        if (!/^\/api\/forms-(?:runtime|placement)(?:\/|$)/.test(url))
            return fetch(path(url), options);
        const location = window.location.pathname.replace(/^\/sites\/[^/]+(?=\/|$)/, '') || '/';
        const host = /^\/posts(?:\/|$)/.test(location) ? 'posts'
            : /^\/wiki(?:\/|$)/.test(location) ? 'wiki'
                : /^\/intranet(?:\/|$)/.test(location) ? 'intranet'
                    : /^\/(?:forms|api|admin)(?:\/|$)/.test(location) ? undefined : 'pages';
        const headers = new Headers(options?.headers);
        if (host)
            headers.set('x-vorti-form-host', host);
        return fetch(path(url), { ...options, headers });
    }, [path]);
}
