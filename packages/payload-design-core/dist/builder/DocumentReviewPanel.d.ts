import { type ReactNode } from 'react';
/** Application-owned review UI; no persistence or permission decisions live here. */
export declare function DocumentReviewPanel({ children, count, open, onOpenChange, disabled, }: {
    children: ReactNode;
    count: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
