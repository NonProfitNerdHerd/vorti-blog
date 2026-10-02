import { type ReactNode } from 'react';
import { type ContentNode, type Viewport } from './model';
export declare function ContentBlock({ node, children, body, viewport, }: {
    node: ContentNode;
    children?: ReactNode;
    body?: ReactNode;
    viewport?: Viewport;
}): import("react/jsx-runtime").JSX.Element;
export declare function ContentRenderer({ nodes, viewport, }: {
    nodes: ContentNode[];
    viewport?: Viewport;
}): import("react/jsx-runtime").JSX.Element;
