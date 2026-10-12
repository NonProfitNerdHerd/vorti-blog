import type { ContentNode, Viewport } from '../content/model';
export declare function RegisteredBlockEditor({ node, change, viewport, bindingFields, listings, }: {
    listings?: Array<{
        id: string;
        label: string;
    }>;
    node: ContentNode;
    bindingFields?: Array<{
        path: string;
        label: string;
    }>;
    viewport?: Viewport;
    change: (node: ContentNode) => void;
}): import("react/jsx-runtime").JSX.Element;
export declare function NewRegisteredBlock({ node, create, cancel, }: {
    node: ContentNode;
    create: (node: ContentNode) => void;
    cancel: () => void;
}): import("react/jsx-runtime").JSX.Element;
