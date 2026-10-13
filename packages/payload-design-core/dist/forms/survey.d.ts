import type { Answers, FormField } from './model';
export interface SurveyBucket {
    id: string;
    label: string;
    count: number;
    rankTotal?: number;
}
export interface SurveyFieldSummary {
    id: string;
    label: string;
    kind: string;
    repeated: boolean;
    responses: number;
    buckets: SurveyBucket[];
    rows?: {
        id: string;
        label: string;
        responses: number;
        buckets: SurveyBucket[];
    }[];
    mean?: number;
    nps?: number;
}
/** One accumulator per immutable revision. No individual answers or free-text fields leave it. */
export declare function surveyAccumulator(fields: FormField[]): {
    add: (answers: Answers) => void;
    result: () => SurveyFieldSummary[];
};
