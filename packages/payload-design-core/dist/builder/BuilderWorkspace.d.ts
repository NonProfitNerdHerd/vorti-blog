import { type ReactNode } from 'react';
/** Layout shared by content authoring, locked templates and template design adapters. */
export declare function BuilderPanels({ children, className, leftOpen, rightOpen }: {
    children: ReactNode;
    className: string;
    leftOpen: boolean;
    rightOpen: boolean;
}): import("react/jsx-runtime").JSX.Element;
export declare function BuilderWorkspace({ canvas, canvasLabel, canvasTitle, inspector, inspectorTitle, library, libraryNavigation, libraryOpen, libraryTitle, onLibraryOpenChange, documentSettings, selectionKey, }: {
    canvas: ReactNode;
    canvasLabel: string;
    canvasTitle: string;
    inspector: ReactNode;
    inspectorTitle: string;
    library: ReactNode;
    libraryNavigation: ReactNode;
    libraryOpen: boolean;
    libraryTitle: string;
    onLibraryOpenChange: (open: boolean) => void;
    documentSettings?: ReactNode;
    selectionKey?: string;
}): import("react/jsx-runtime").JSX.Element;
