import React from 'react';
import { type Answers, type FormDefinition, type FormField, type FormIssue, type FormValue } from './model';
import './forms.css';
import { type BookingAdapter } from './BookingInput';
export interface UploadResult {
    id: string;
    name: string;
    status: 'unscanned' | 'pending' | 'clean' | 'rejected' | 'error';
}
export interface FormRendererProps {
    definition: FormDefinition;
    initialAnswers?: Answers;
    preview?: boolean;
    disabled?: boolean;
    onChange?: (answers: Answers) => void;
    onSubmit?: (answers: Answers) => Promise<{
        message?: string;
        errors?: FormIssue[];
        redirect?: string;
        analyticsRecorded?: boolean;
    }>;
    onSave?: (answers: Answers) => Promise<{
        message: string;
    }>;
    onUpload?: (file: File, field: FormField, progress: (percent: number) => void) => Promise<UploadResult>;
    onEvent?: (type: 'view' | 'start' | 'step' | 'step-exit' | 'error' | 'accepted', metadata: {
        step?: string;
        fields?: string[];
        durationMs?: number;
        consent?: boolean;
    }) => void;
    onAnalyticsConsent?: (consent: boolean) => void;
    showLogic?: boolean;
    booking?: BookingAdapter;
}
export interface FieldInputProps {
    field: FormField;
    value: FormValue | undefined;
    onChange: (value: FormValue) => void;
    id: string;
    disabled?: boolean;
    describedBy?: string;
    invalid?: boolean;
    onUpload?: FormRendererProps['onUpload'];
}
export declare const fieldRenderers: Map<string, React.ComponentType<FieldInputProps>>;
export declare function registerFieldRenderer(kind: string, renderer: React.ComponentType<FieldInputProps>): void;
export declare function FormRenderer({ definition, initialAnswers, preview, disabled, onChange, onSubmit, onSave, onUpload, onEvent, onAnalyticsConsent, showLogic, booking }: FormRendererProps): import("react/jsx-runtime").JSX.Element;
