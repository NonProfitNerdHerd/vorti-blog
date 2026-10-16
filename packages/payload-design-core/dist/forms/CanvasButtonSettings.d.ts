import { type FormDefinition, type FormField } from './model';
export declare function CanvasButtonSettings({ field, definition, onChange }: {
    field: FormField;
    definition: FormDefinition;
    onChange: (buttons: NonNullable<FormField['buttons']>) => void;
}): import("react/jsx-runtime").JSX.Element;
