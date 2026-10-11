import { type ReactNode } from 'react';
import type { ContentNode } from '../content/model';
export declare const blockIcons: Record<string, string>;
export declare function CatalogRenderer({ node, children, editing, }: {
    node: ContentNode;
    children?: ReactNode;
    editing?: boolean;
}): import("react/jsx-runtime").JSX.Element;
