import type { FormIssue } from './model';
/** Safe on untrusted imports and API bodies. Drafts may be unfinished, but not structurally malformed. */
export declare function definitionShapeIssues(value: unknown): FormIssue[];
