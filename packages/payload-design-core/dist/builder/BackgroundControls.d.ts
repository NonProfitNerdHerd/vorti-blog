import type { ReactNode } from 'react';
import { type BlockPresentation, type BackgroundSettings } from '../blocks/presentation';
export declare function BackgroundControls({ background, device, change, renderMedia, color, gradient, styleChange, reset, }: {
    background: BlockPresentation['background'];
    device: 'desktop' | 'tablet' | 'mobile';
    change: (background: BlockPresentation['background']) => void;
    renderMedia?: (value: BlockPresentation['background'], change: (value: BackgroundSettings) => void) => ReactNode;
    color: string;
    gradient: string;
    styleChange: (key: string, value: string) => void;
    reset: () => void;
}): import("react/jsx-runtime").JSX.Element;
