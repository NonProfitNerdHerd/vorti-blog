import type { CSSProperties } from 'react';
export declare function registerBlockIcon(key: string, path: string): void;
/** Editor identity icons; separate from icons authored inside page content. */
export declare const blockGlyphs: Record<string, string>;
export declare function BlockGlyph({ kind, style }: {
    kind: string;
    style?: CSSProperties;
}): import("react/jsx-runtime").JSX.Element;
