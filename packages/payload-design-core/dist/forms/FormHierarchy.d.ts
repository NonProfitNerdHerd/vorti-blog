import { type FormField } from './model';
export declare function FormHierarchy({ canvases, selected, select, menu, readOnly }: {
    canvases: FormField[];
    selected?: string;
    select: (id: string) => void;
    menu: (id: string) => void;
    readOnly?: boolean;
}): import("react/jsx-runtime").JSX.Element;
