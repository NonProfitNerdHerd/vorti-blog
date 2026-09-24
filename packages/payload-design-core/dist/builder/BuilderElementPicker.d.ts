import type { BuilderDragItem } from './BuilderCore';
export type BuilderPickerElement = BuilderDragItem & {
    category: string;
    description: string;
    keywords: string[];
};
export declare function BuilderElementPicker({ categories, categoryLabels, close, elements, onChoose, }: {
    categories: string[];
    categoryLabels: Record<string, string>;
    close: () => void;
    elements: BuilderPickerElement[];
    onChoose: (item: BuilderDragItem) => void;
}): import("react/jsx-runtime").JSX.Element;
