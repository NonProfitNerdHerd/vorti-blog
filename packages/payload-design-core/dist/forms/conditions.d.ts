import { type Answers, type Condition, type FormValue, type Operator } from './model';
type Compare = (left: FormValue | undefined, right: FormValue | undefined) => boolean;
/** Calendar dates compare as dates; instants require explicit offsets, never server-local time. */
export declare function comparableDate(value: unknown): number | undefined;
export declare const conditionOperators: Record<Operator, Compare>;
export declare function matches(condition: Condition, answers: Answers, depth?: number): boolean;
export declare function conditionReferences(condition: Condition, depth?: number): string[];
export {};
