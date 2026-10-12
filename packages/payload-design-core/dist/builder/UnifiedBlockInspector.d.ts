import { type ReactNode } from 'react';
import { type BlockPresentation } from '../blocks/presentation';
import { type ContentNode, type Viewport } from '../content/model';
import './block-inspector.css';
type InspectorTab = 'layout' | 'style' | 'advanced';
export declare function BlockInspectorStateProvider({ children }: {
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function UnifiedBlockInspector({ node, onChange, viewport: suppliedViewport, disabled, children, layoutControls, contentLabel, bindingFields, showFields, renderBackgroundMedia, renderDocumentPicker, listings, activeTab, hideHeader, }: {
    node: ContentNode;
    listings?: Array<{
        id: string;
        label: string;
    }>;
    renderDocumentPicker?: (collection: string, label: string, value: string, change: (value: string) => void) => ReactNode;
    renderBackgroundMedia?: (value: BlockPresentation['background'], change: (value: NonNullable<BlockPresentation['background']>) => void) => ReactNode;
    showFields?: boolean;
    bindingFields?: Array<{
        path: string;
        label: string;
    }>;
    onChange: (patch: Partial<ContentNode>) => void;
    viewport?: Viewport;
    disabled?: boolean;
    children?: ReactNode;
    layoutControls?: ReactNode;
    contentLabel?: string;
    activeTab?: InspectorTab;
    hideHeader?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export {};
