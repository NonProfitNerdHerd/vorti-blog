import React from 'react';
import type { FormField } from './model';
/** Measure the actual viewport instead of using 100vw, which includes the scrollbar. */
export declare function FormColumns({ field, preview, disabled, children }: {
    field: FormField;
    preview?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
