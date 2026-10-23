import { type AnchorHTMLAttributes, type ReactNode } from 'react';
export declare function PublicSiteProvider({ prefix, preview, children, }: {
    prefix: string;
    preview?: boolean;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function sitePath(prefix: string, path: string): string;
export declare function usePublicSitePath(): (path: string) => string;
export declare function SiteAnchor({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): import("react/jsx-runtime").JSX.Element;
export declare function usePublicFetch(): (url: string, options?: RequestInit) => Promise<Response>;
