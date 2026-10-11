import type { ContentNode } from '../content/model';
import type { TemplateNode } from '../types';
import type { SiteShellNode } from '../site-shell';
/** View-only projection: never persisted or used to replace the document schema. */
export type SidebarNode = {
    id: string;
    ownerID?: string;
    label: string;
    kind: string;
    children?: SidebarNode[];
    container?: boolean;
    immovable?: boolean;
    text?: string;
    heading?: number;
};
export type InsertionTarget = {
    parent: string;
    before?: string;
};
export declare const flattenSidebar: (nodes: SidebarNode[]) => SidebarNode[];
export declare function locateSidebar(nodes: SidebarNode[], id: string, parent?: string): {
    node: SidebarNode;
    parent: string;
    siblings: SidebarNode[];
    index: number;
} | undefined;
export declare function insertionTarget(nodes: SidebarNode[], selected?: string): InsertionTarget;
export declare function outlineSummary(nodes: SidebarNode[]): {
    headings: SidebarNode[];
    words: number;
    minutes: number;
};
export declare function contentSidebarNodes(nodes: ContentNode[]): SidebarNode[];
export declare function templateSidebarNodes(nodes: TemplateNode[]): SidebarNode[];
export declare function shellSidebarNodes(nodes: SiteShellNode[]): SidebarNode[];
/** Copies structural IDs only; custom-field references remain shared by template design. */
export declare function duplicateBuilderNode<T>(node: T): T;
