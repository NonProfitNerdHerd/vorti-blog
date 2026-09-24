export declare const SITE_SHELL_LAYOUT_KINDS: readonly ["container", "row", "columns", "stack", "spacer", "divider"];
export declare const SITE_SHELL_ELEMENT_KINDS: readonly ["logo", "siteName", "navigation", "button", "search", "text", "richText", "icon", "image", "socialLinks", "mobileMenuToggle", "copyright", "currentYear"];
export type SiteShellLayoutKind = (typeof SITE_SHELL_LAYOUT_KINDS)[number];
export type SiteShellElementKind = (typeof SITE_SHELL_ELEMENT_KINDS)[number];
export type ResponsiveValue<T> = T | {
    desktop: T;
    tablet?: T;
    mobile?: T;
};
export type SiteShellStyleScalar = string | number | boolean | null;
export type SiteShellStyle = Record<string, ResponsiveValue<SiteShellStyleScalar>>;
export type SiteShellElementNode = {
    id: string;
    type: 'element';
    element: SiteShellElementKind;
    props?: Record<string, unknown>;
    style?: SiteShellStyle;
};
export type SiteShellColumn = {
    id: string;
    width: number;
    children: SiteShellNode[];
};
export type SiteShellLayoutNode = {
    id: string;
    type: 'layout';
    layout: SiteShellLayoutKind;
    children?: SiteShellNode[];
    columns?: SiteShellColumn[];
    style?: SiteShellStyle;
};
export type SiteShellNode = SiteShellLayoutNode | SiteShellElementNode;
export type SiteShellRegionSettings = {
    widthMode?: 'contained' | 'full';
    maxWidth?: number;
    minHeight?: number;
    padding?: string;
    margin?: string;
    backgroundColor?: string;
    backgroundImage?: string | number;
    border?: string;
    boxShadow?: string;
    position?: 'static' | 'sticky' | 'fixed';
    transparent?: boolean;
    zIndex?: number;
};
export type SiteShellRegion = {
    layout: SiteShellNode[];
    settings?: SiteShellRegionSettings;
};
export type SiteTemplateAssignment = {
    mode: 'default';
    priority: number;
};
export declare const ADDITIONAL_CSS_MAX_LENGTH = 50000;
export declare function validateAdditionalCSS(value: unknown): true | string;
export declare function validateSiteShellNodes(value: unknown): true | string;
