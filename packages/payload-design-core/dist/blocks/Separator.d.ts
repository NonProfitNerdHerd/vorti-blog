import type { CSSProperties } from 'react';
export declare const separatorPaths: Record<string, string>;
export type SeparatorSettings = {
    shape: string;
    height?: number;
    width?: number;
    color?: string;
    flip?: boolean;
    layers?: number;
    shadow?: boolean;
};
export declare function Separator({ settings, style, }: {
    settings: SeparatorSettings;
    style?: CSSProperties;
}): import("react/jsx-runtime").JSX.Element;
