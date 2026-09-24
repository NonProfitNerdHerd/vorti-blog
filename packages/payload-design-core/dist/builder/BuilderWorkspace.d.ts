import type { ReactNode } from 'react';
export declare function BuilderWorkspace({ canvas, canvasLabel, canvasTitle, inspector, inspectorTitle, library, libraryNavigation, libraryOpen, libraryTitle, onLibraryOpenChange, }: {
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
}): import("react/jsx-runtime").JSX.Element;
