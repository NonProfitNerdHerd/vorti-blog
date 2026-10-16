import { type FormField } from './model';
export declare function FormHierarchy({ canvases, selected, select, menu, readOnly, component, open }: {
    canvases: FormField[];
    selected?: string;
    select: (id: string, component?: string) => void;
    menu: (id: string) => void;
    readOnly?: boolean;
    component?: string;
    open: (id: string, component?: string) => void;
}): import("react/jsx-runtime").JSX.Element;
