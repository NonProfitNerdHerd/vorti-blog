import { type ReactNode } from 'react';
import type { ContentNode } from '../content/model';
export declare const blockIcons: Record<string, string>;
export declare function CatalogRenderer({ node, children, editing, viewport, }: {
    node: ContentNode;
    children?: ReactNode;
    editing?: boolean;
    viewport?: 'desktop' | 'tablet' | 'mobile';
}): import("react/jsx-runtime").JSX.Element;
