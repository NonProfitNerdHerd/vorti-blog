import type { ReactNode } from 'react';
import type { BuilderDragItem } from './BuilderCore';
export declare function DropArea({ add, addItem, children, id, label, }: {
    add?: () => void;
    addItem?: (item: BuilderDragItem) => void;
    children: ReactNode;
    id: string;
    label: string;
}): import("react/jsx-runtime").JSX.Element;
