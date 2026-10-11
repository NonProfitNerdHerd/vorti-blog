import { type ReactNode } from 'react';
import { type ContentNode, type Viewport } from '../content/model';
import './block-inspector.css';
export declare function BlockInspectorStateProvider({ children }: {
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function UnifiedBlockInspector({ node, onChange, viewport: suppliedViewport, disabled, children, bindingFields, showFields, }: {
    node: ContentNode;
    showFields?: boolean;
    bindingFields?: Array<{
        path: string;
        label: string;
    }>;
    onChange: (patch: Partial<ContentNode>) => void;
    viewport?: Viewport;
    disabled?: boolean;
    children?: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
