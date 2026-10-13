import { type Answers, type FormAction, type FormDefinition, type FormField } from './model';
export interface CMSMapping {
    key: string;
    label: string;
    kinds: string[];
    required?: boolean;
}
export declare const cmsMappings: Record<string, CMSMapping[]>;
export declare function cmsMappingFields(fields: FormField[]): FormField[];
export declare function cmsActionIssues(action: FormAction, definition: Pick<FormDefinition, 'fields'>): string[];
export declare function mappedCMSText(answers: Answers, action: FormAction, key: string, required?: boolean): string;
