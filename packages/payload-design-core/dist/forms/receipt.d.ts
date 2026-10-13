import type { Answers, FormField } from './model';
/** Shared printable receipt: escaped content only, with no JavaScript or external assets. */
export declare function receiptDocument(input: {
    title: string;
    fields: FormField[];
    answers: Answers;
    entryID: string;
    revision: string;
    submittedAt: string;
}): string;
