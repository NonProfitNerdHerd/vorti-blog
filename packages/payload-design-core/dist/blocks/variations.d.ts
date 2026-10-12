import type { ContentNode, ResponsiveBlockStyle } from '../content/model';
export type BlockVariation = {
    id: string;
    label: string;
    thumbnail: 'stack' | 'split' | 'overlay' | 'grid';
    styles?: ResponsiveBlockStyle;
};
export type StylingTarget = {
    id: string;
    label: string;
    selector: string;
};
export declare function registerVariations(kind: string, variations?: BlockVariation[]): void;
export declare const styleOnlyKinds: Set<string>;
export declare const compositeKinds: Set<string>;
export declare function variationsFor(kind: string): BlockVariation[];
export declare function targetsFor(kind: string): StylingTarget[];
export declare function roleFor(node: ContentNode): string;
/** A layout change annotates existing children; it never removes or recreates content. */
export declare function applyVariation(node: ContentNode, id: string): ContentNode;
export declare function variationStyles(node: ContentNode): ResponsiveBlockStyle;
export declare function effectiveStyles(node: ContentNode): ResponsiveBlockStyle;
export declare function resetLayoutStyles(node: ContentNode): ResponsiveBlockStyle | undefined;
export declare function validateVariation(node: ContentNode): string | undefined;
