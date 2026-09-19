import type { BlockDesign, ExportEnvelope, Template } from './types';
export declare function exportBlockDesign(design: BlockDesign, blockTypeSlug: string): ExportEnvelope<Omit<BlockDesign, 'id' | 'blockType'> & {
    blockTypeSlug: string;
}>;
export declare function exportTemplate(template: Template, designSlugs: Record<string, string>): ExportEnvelope<Omit<Template, 'id' | 'sections'> & {
    sections: Array<Omit<Template['sections'][number], 'blockDesign'> & {
        blockDesignSlug: string;
    }>;
}>;
export declare function validateExport(value: unknown): value is ExportEnvelope<unknown>;
