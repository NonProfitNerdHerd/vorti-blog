import type { TemplateNode, TemplateLayoutNode } from '../types';
import type { SiteShellNode, SiteShellLayoutNode } from '../site-shell';
import { type ContentNode } from '../content/model';
export declare function adapterPreviewNodes(nodes: Array<TemplateNode | SiteShellNode>): ContentNode[];
export declare function adapterListings(nodes: Array<TemplateNode | SiteShellNode>): Array<{
    id: string;
    label: string;
}>;
/** The wrapper preserves existing tree/storage paths; block contains only this node's values. */
export declare function toTemplateBlock(node: ContentNode): TemplateLayoutNode;
export declare function toShellBlock(node: ContentNode): SiteShellLayoutNode;
export declare function mergeTemplateBlock(original: TemplateNode, node: ContentNode): TemplateNode;
export declare function mergeShellBlock(original: SiteShellNode, node: ContentNode): SiteShellNode;
export declare function templateBlockValue(node: TemplateNode): ContentNode | undefined;
export declare function shellBlockValue(node: SiteShellNode): ContentNode | undefined;
export declare function canInsertAdapterNode(parent: TemplateNode | SiteShellNode | null | undefined, child: TemplateNode | SiteShellNode, root?: boolean): boolean;
