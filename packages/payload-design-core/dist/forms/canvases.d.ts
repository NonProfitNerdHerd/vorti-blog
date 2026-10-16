import { type FormDefinition, type FormField } from './model';
export declare const virtualCanvasID = "__existing_canvas__";
export declare const containerKinds: string[];
export declare function canvasItems(fields: FormField[]): FormField[];
export declare function owningCanvas(fields: FormField[], id?: string): string | undefined;
export declare function editPart(fields: FormField[], id: string, update: (field: FormField) => FormField | null): FormField[];
export declare function organizeIssue(fields: FormField[]): string | undefined;
export declare function newCanvas(fields: FormField[]): FormField;
export declare function organizeCanvases(definition: FormDefinition): FormDefinition;
/** Explicit destination: containers receive children; ordinary parts receive a preceding sibling. */
export declare function movePart(fields: FormField[], id: string, target: string): FormField[];
export declare function deletionPlan(definition: FormDefinition, id: string): {
    blockers: string[];
    definition: FormDefinition;
};
