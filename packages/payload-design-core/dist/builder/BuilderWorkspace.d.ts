import { type ReactNode } from 'react';
import type { Viewport } from '../content/model';
/** Layout shared by content authoring, locked templates and template design adapters. */
export declare function BuilderPanels({ children, className, leftOpen, rightOpen, viewport, onViewportChange, }: {
    children: ReactNode;
    className: string;
    leftOpen: boolean;
    rightOpen: boolean;
    viewport?: Viewport;
    onViewportChange?: (value: Viewport) => void;
}): import("react/jsx-runtime").JSX.Element;
export declare function BuilderWorkspace({ canvas, canvasLabel, canvasTitle, inspector, documentLabel, viewport, onViewportChange, library, libraryNavigation, libraryOpen, libraryTitle, onLibraryOpenChange, documentSettings, selectionKey, sidebar, sidebarControls, readOnly, }: {
    canvas: ReactNode;
    canvasLabel: string;
    canvasTitle: string;
    inspector: ReactNode;
    documentLabel?: string;
    viewport?: Viewport;
    onViewportChange?: (value: Viewport) => void;
    inspectorTitle: string;
    library: ReactNode;
    libraryNavigation: ReactNode;
    libraryOpen: boolean;
    libraryTitle: string;
    onLibraryOpenChange: (open: boolean) => void;
    documentSettings?: ReactNode;
    selectionKey?: string;
    sidebar?: ReactNode;
    sidebarControls?: ReactNode;
    readOnly?: boolean;
}): import("react/jsx-runtime").JSX.Element;
