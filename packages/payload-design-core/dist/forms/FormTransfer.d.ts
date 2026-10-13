import type { FormDefinition } from './model';
export declare function FormTransfer({ value, onImport, readOnly }: {
    value: FormDefinition;
    onImport: (definition: FormDefinition) => void;
    readOnly?: boolean;
}): import("react/jsx-runtime").JSX.Element;
