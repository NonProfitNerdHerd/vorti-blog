import type { TemplateField, TemplateNode } from './types';
export declare function walkTemplate(nodes: TemplateNode[], visit: (node: TemplateNode, parent: string | null) => void, parent?: string | null): void;
export declare function templateFields(nodes: TemplateNode[]): TemplateField[];
export declare function findTemplateNode(nodes: TemplateNode[], id: string): TemplateNode | null;
export declare function updateTemplateNode(nodes: TemplateNode[], id: string, update: (node: TemplateNode) => TemplateNode): TemplateNode[];
export declare function removeTemplateNode(nodes: TemplateNode[], id: string): TemplateNode[];
export declare function moveTemplateNode(nodes: TemplateNode[], id: string, direction: -1 | 1): TemplateNode[];
export declare function collectFieldIDs(nodes: TemplateNode[]): string[];
export declare function extractTemplateNode(nodes: TemplateNode[], id: string): {
    nodes: TemplateNode[];
    extracted: TemplateNode | null;
};
export declare function insertTemplateNode(nodes: TemplateNode[], containerID: string, nodeToInsert: TemplateNode): TemplateNode[];
export declare function moveTemplateNodeTo(nodes: TemplateNode[], id: string, containerID: string): TemplateNode[];
