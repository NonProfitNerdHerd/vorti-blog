import { type AnchorHTMLAttributes, type ReactNode } from 'react';
export declare function PublicSiteProvider({ prefix, preview, audience, children, }: {
    prefix: string;
    preview?: boolean;
    audience?: 'public' | 'intranet';
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function sitePath(prefix: string, path: string, audience?: 'public' | 'intranet'): string;
export declare function usePublicSitePath(): (path: string) => string;
export declare function SiteAnchor({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): import("react/jsx-runtime").JSX.Element;
export declare function publicRequestHeaders(url: string, audience: 'public' | 'intranet', pathname: string, input?: HeadersInit): HeadersInit | undefined;
export declare function usePublicRequestHeaders(): (url: string, input?: HeadersInit) => HeadersInit | undefined;
export declare function usePublicFetch(): (url: string, options?: RequestInit) => Promise<Response>;
