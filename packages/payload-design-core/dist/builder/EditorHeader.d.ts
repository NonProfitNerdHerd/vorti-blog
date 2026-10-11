import { type ReactNode } from 'react';
import type { Viewport } from '../content/model';
import './editor-header.css';
type Slot = 'title' | 'history' | 'navigation' | 'preview' | 'actions';
export declare function EditorTitleSlot(): import("react/jsx-runtime").JSX.Element;
export declare function EditorHistorySlot(): import("react/jsx-runtime").JSX.Element;
export declare function EditorPreviewSlot(): import("react/jsx-runtime").JSX.Element;
export declare function EditorHeaderPortal({ slot, children }: {
    slot: Slot;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function EditorHistory({ undo, redo, canUndo, canRedo, }: {
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}): import("react/jsx-runtime").JSX.Element;
export declare function EditorDevices({ value, onChange, }: {
    value: Viewport;
    onChange: (value: Viewport) => void;
}): import("react/jsx-runtime").JSX.Element;
/** Template names use the same existing form path as their hidden schema field. */
export declare function EditorName(): import("react/jsx-runtime").JSX.Element;
export {};
