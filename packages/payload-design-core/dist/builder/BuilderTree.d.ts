import type { CSSProperties, ReactNode } from 'react';
import type { BuilderDragItem } from './BuilderCore';
export type BuilderChildContainer<TNode> = {
    children: TNode[];
    className?: string;
    id: string;
    label: string;
    listLabel?: string;
};
export type BuilderNodeDescriptor<TNode> = {
    body: ReactNode;
    bodyAriaLabel?: string;
    children?: BuilderChildContainer<TNode>[];
    childrenClassName?: string;
    childrenStyle?: CSSProperties;
    icon?: ReactNode;
    listTitle?: string;
    title: string;
};
export type BuilderTreeActions<TNode> = {
    add: (containerID: string) => void;
    addItem: (item: BuilderDragItem, containerID: string) => void;
    edit: (node: TNode) => void;
    move: (id: string, direction: -1 | 1) => void;
    remove: (id: string) => void;
};
export declare function BuilderCanvasTree<TNode>({ actions, describe, id, nodes, selectedID }: {
    actions: BuilderTreeActions<TNode>;
    describe: (node: TNode) => BuilderNodeDescriptor<TNode>;
    id: (node: TNode) => string;
    nodes: TNode[];
    selectedID?: string;
}): import("react/jsx-runtime").JSX.Element;
export declare function BuilderListView<TNode>({ describe, id, nodes, onSelect, selectedID, depth }: {
    depth?: number;
    describe: (node: TNode) => BuilderNodeDescriptor<TNode>;
    id: (node: TNode) => string;
    nodes: TNode[];
    onSelect: (node: TNode) => void;
    selectedID?: string;
}): import("react/jsx-runtime").JSX.Element;
