import { type FormDefinition } from './model';
export interface FormPackage {
    format: 'vorti-form';
    version: 1;
    title: string;
    definition: FormDefinition;
}
/** Portable exports deliberately omit provider configuration and private action mappings. */
export declare function exportForm(title: string, definition: FormDefinition): FormPackage;
export declare function importForm(input: unknown): FormPackage;
/** This is the only definition projection allowed on unauthenticated endpoints. */
export declare function publicDefinition(definition: FormDefinition): FormDefinition;
