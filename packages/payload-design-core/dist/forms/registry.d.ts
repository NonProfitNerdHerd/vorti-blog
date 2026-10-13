import type { FormField, FormValue } from './model';
export interface FieldRegistration {
    kind: string;
    label: string;
    category: 'Basic' | 'Choices' | 'Dates' | 'Advanced' | 'Layout';
    description: string;
    input?: string;
    structural?: boolean;
    choices?: boolean;
    numeric?: boolean;
    validate: (value: FormValue, field: FormField) => string[];
    format: (value: FormValue, field: FormField) => string;
}
/** Registries reject collisions so a plugin cannot silently change stored semantics. */
export declare class Registry<T extends {
    kind: string;
}> {
    private entries;
    register(value: T): void;
    get(kind: string): T | undefined;
    list(): T[];
}
export declare const formFields: Registry<FieldRegistration>;
export declare const structuredFormat: (value: FormValue) => string;
export declare function validDate(value: string): boolean;
