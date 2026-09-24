import type { BuilderDragItem } from './BuilderCore';
export declare function takePendingLibraryItem(): BuilderDragItem | null;
export declare function BuilderLibraryButton({ item, onAdd }: {
    item: BuilderDragItem;
    onAdd: () => void;
}): import("react/jsx-runtime").JSX.Element;
