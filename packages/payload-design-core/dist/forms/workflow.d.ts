export declare const entryStatuses: readonly ["received", "in-review", "approved", "rejected", "completed"];
export type EntryStatus = typeof entryStatuses[number];
export interface EntryTransition {
    from: EntryStatus;
    to: EntryStatus;
    roles: ('administrator' | 'designer' | 'editor')[];
}
export interface EntryWorkflow {
    transitions: EntryTransition[];
}
export declare const defaultWorkflow: EntryWorkflow;
export declare function mayTransition(from: string, to: string, role: string, workflow?: EntryWorkflow): boolean;
export declare function workflowIssues(value: unknown): string[];
