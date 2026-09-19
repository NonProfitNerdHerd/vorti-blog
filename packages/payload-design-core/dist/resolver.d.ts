import type { BlockDesign, BlockType, ID, ResolvedContent, ResolvedTemplate, Template, TemplatedContent } from './types';
export type ResolveMode = 'published' | 'draft';
export type DesignStore = {
    getTemplate(id: ID, mode: ResolveMode): Promise<Template | null>;
    getBlockDesign(id: ID, mode: ResolveMode): Promise<BlockDesign | null>;
    getBlockType(id: ID, mode: ResolveMode): Promise<BlockType | null>;
};
export declare function resolveBlockDesign(store: DesignStore, id: ID, mode?: ResolveMode): Promise<{
    blockDesign: BlockDesign;
    blockType: BlockType;
}>;
export declare function resolveTemplate(store: DesignStore, id: ID, mode?: ResolveMode): Promise<ResolvedTemplate>;
export declare function resolveContentTemplate(store: DesignStore, content: TemplatedContent, mode?: ResolveMode): Promise<ResolvedContent>;
