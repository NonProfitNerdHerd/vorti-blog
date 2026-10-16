import React from 'react';
/** Native dialog provides focus containment, Escape dismissal, and return focus. */
export declare function FormBuilderDialog({ title, close, anchor, children }: {
    title: string;
    close: () => void;
    anchor?: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
}): React.ReactPortal;
