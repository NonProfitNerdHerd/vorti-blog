import { type FormField, type FormDefinition } from './model';
export declare function FieldSettings({ current, value, readOnly, update, chooseLayout, shift, move, duplicate, setDeleteID, resources, component }: {
    current: FormField;
    value: FormDefinition;
    readOnly?: boolean;
    update: (patch: Partial<FormField>) => void;
    chooseLayout: (id: string, weights: number[]) => void;
    shift: (delta: number) => void;
    move: (id: string, target: string) => void;
    duplicate: (id: string) => void;
    setDeleteID: (id: string) => void;
    resources?: {
        id: string;
        label: string;
    }[];
    component?: string;
}): import("react/jsx-runtime").JSX.Element;
