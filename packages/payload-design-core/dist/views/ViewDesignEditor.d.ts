import type { ReactNode } from 'react';
import type { BlockPresentation } from '../blocks/presentation';
import type { Viewport } from '../content/model';
import type { ViewConfig } from './model';
/** The same inspector and responsive state used by document blocks. */
export declare function ViewDesignEditor({ value, onChange, viewport, onDeviceChange, disabled, renderBackgroundMedia, tab, }: {
    value: ViewConfig['design'];
    onChange: (value: NonNullable<ViewConfig['design']>) => void;
    viewport: Viewport;
    onDeviceChange: (device: Viewport) => void;
    disabled?: boolean;
    tab?: 'layout' | 'style' | 'advanced';
    renderBackgroundMedia?: (value: BlockPresentation['background'], change: (value: NonNullable<BlockPresentation['background']>) => void) => ReactNode;
}): import("react/jsx-runtime").JSX.Element;
