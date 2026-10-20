export type MenuItem = {
    key: string;
    parent?: string | null;
    label: string;
    kind: 'page' | 'post' | 'custom';
    target?: number | null;
    url?: string;
    enabled?: boolean;
    newTab?: boolean;
};
export type MenuLink = {
    key: string;
    label: string;
    href: string;
    newTab?: boolean;
    children: MenuLink[];
};
export type ResolvedMenu = {
    id: number;
    name: string;
    items: MenuLink[];
};
export declare function safeMenuURL(value: unknown): value is string;
export declare function validateMenuItems(value: unknown): true | string;
export declare function orderedMenu(items: MenuItem[]): MenuItem[];
export declare function menuDepth(items: MenuItem[], key: string): number;
export declare function moveMenuBranch(items: MenuItem[], key: string, parent: string | null, before?: string): MenuItem[];
export declare function removeMenuItem(items: MenuItem[], key: string, branch: boolean): MenuItem[];
