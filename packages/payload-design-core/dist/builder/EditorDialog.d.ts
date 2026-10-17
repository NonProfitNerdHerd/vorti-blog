import { type ReactNode } from 'react';
import './editor-dialog.css';
/** Keeps inline controls mounted while expanding them into a centered editor. */
export declare function EditorDialog({ open, inline, title, onClose, children, }: {
    open: boolean;
    inline?: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element | null;
