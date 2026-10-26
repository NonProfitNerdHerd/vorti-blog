import { type ReactNode } from 'react';
import './editor-dialog.css';
/** Keeps inline controls mounted while expanding them into a centered editor. */
export declare function EditorDialog({ open, inline, title, onClose, children, heading, topAligned, }: {
    open: boolean;
    inline?: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    heading?: ReactNode;
    topAligned?: boolean;
}): import("react/jsx-runtime").JSX.Element | null;
