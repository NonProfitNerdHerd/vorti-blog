import type { FieldRule, TypeField, TypeFieldKind } from './model';
export type FieldIssue = {
    field: string;
    message: string;
};
export type MediaFacts = Record<string, {
    mimeType?: string | null;
    filesize?: number | null;
}>;
export declare const ruleLabels: Record<FieldRule['kind'], string>;
export declare function availableRules(kind: TypeFieldKind): FieldRule['kind'][];
export declare function fieldDate(value: unknown): number;
export declare function evaluateFieldRules(fields: TypeField[], values: Record<string, unknown>, media?: MediaFacts): FieldIssue[];
export declare function validateRuleDefinitions(fields: TypeField[]): FieldIssue[];
