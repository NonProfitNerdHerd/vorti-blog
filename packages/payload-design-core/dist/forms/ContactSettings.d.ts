import type { FormField } from './model';
export declare function ContactSettings({ field, update }: {
    field: FormField;
    update: (patch: Partial<FormField>) => void;
}): import("react/jsx-runtime").JSX.Element | null;
export declare function ComponentSettings({ field, component, update, disabled }: {
    field: FormField;
    component: string;
    update: (patch: Partial<FormField>) => void;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
