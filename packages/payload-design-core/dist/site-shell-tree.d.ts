import type { SiteShellNode } from './site-shell';
export declare function findSiteShellNode(nodes: SiteShellNode[], id: string): SiteShellNode | null;
export declare function updateSiteShellNode(nodes: SiteShellNode[], id: string, next: SiteShellNode): SiteShellNode[];
export declare function removeSiteShellNode(nodes: SiteShellNode[], id: string): SiteShellNode[];
export declare function insertSiteShellNode(nodes: SiteShellNode[], parentID: string, inserted: SiteShellNode): SiteShellNode[];
export declare function moveSiteShellNode(nodes: SiteShellNode[], id: string, direction: -1 | 1): SiteShellNode[];
export declare function moveSiteShellNodeTo(nodes: SiteShellNode[], id: string, parentID: string): SiteShellNode[];
