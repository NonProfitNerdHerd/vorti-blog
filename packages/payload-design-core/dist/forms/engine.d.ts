import { type Answers, type FormDefinition, type FormField, type FormIssue, type FormValue } from './model';
export interface FieldState {
    visible: boolean;
    enabled: boolean;
    required: boolean;
    style?: string;
}
export interface Evaluation {
    answers: Answers;
    states: Record<string, FieldState>;
    matchedRules: string[];
    actions: string[];
    confirmation: string;
    route?: string;
    issues: FormIssue[];
}
export declare function validateDefinition(definition: FormDefinition): FormIssue[];
export declare function evaluateForm(definition: FormDefinition, input: Answers): Evaluation;
export declare function validateAnswers(definition: FormDefinition, input: Answers, options?: {
    partial?: boolean;
    now?: Date;
}): Evaluation;
export declare function validateDate(field: FormField, value: string, now: Date): string[];
/** Date-only constraints use calendar days; lead time uses elapsed instants across DST changes. */
export declare function validateTemporal(field: FormField, value: FormValue, now: Date): string[];
