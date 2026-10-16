import { type FormDefinition, type FormField } from './model';
export declare const columnPresets: number[][];
export declare const columnTracks: (field: FormField) => string | undefined;
export declare function createColumn(index: number, weight: number): FormField;
export declare function canUseFullWidth(fields: FormField[], id: string): boolean;
export declare function setColumnLayout(definition: FormDefinition, id: string, weights: number[]): {
    definition: FormDefinition;
    error?: string;
};
