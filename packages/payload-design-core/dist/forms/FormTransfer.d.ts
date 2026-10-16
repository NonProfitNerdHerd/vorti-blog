import type { FormDefinition } from './model';
export declare function FormTransfer({ value, onImport, readOnly, expanded }: {
    value: FormDefinition;
    onImport: (definition: FormDefinition) => void;
    readOnly?: boolean;
    expanded?: boolean;
}): import("react/jsx-runtime").JSX.Element;
