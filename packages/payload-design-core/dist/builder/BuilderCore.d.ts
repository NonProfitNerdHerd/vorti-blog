import type { ReactNode } from 'react';
export type BuilderDragItem = {
    kind: string;
    label: string;
    value: string;
};
export declare function BuilderCore({ children, id, onInsert, onMove, }: {
    children: ReactNode;
    id: string;
    onInsert: (item: BuilderDragItem, containerID: string) => void;
    onMove: (nodeID: string, containerID: string) => void;
}): import("react/jsx-runtime").JSX.Element;
