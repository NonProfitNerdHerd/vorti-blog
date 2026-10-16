import type { FormField, FormValue } from './model';
export declare const blockLabel: (field: FormField) => string;
export declare const widthFraction: (field: FormField) => number;
export declare const widthStyle: (fraction: number) => import("react").CSSProperties;
export declare const usStates: string[];
export interface ContactComponent {
    key: string;
    label: string;
    widthFraction: number;
    autocomplete?: string;
    help?: string;
    placeholder?: string;
}
export declare function contactComponents(field: FormField): ContactComponent[];
export declare function normalizePhone(value: FormValue, field: FormField): FormValue;
export declare function normalizeContact(value: FormValue, field: FormField): FormValue;
export declare function contactErrors(value: FormValue, field: FormField): string[];
