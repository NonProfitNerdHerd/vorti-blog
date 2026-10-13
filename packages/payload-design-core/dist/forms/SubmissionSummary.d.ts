import type { ReactNode } from 'react';
import type { Answers, FormField } from './model';
import './summary.css';
export interface SubmissionSummaryProps {
    fields: FormField[];
    answers: Answers;
    attachment?: (id: string, field: FormField) => ReactNode;
}
export declare function SubmissionSummary({ fields, answers, attachment }: SubmissionSummaryProps): import("react/jsx-runtime").JSX.Element;
