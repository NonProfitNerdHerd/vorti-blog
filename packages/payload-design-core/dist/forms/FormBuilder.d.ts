import React from 'react';
import { type FormDefinition } from './model';
import type { PaymentAvailability } from './PaymentSettings';
import './builder.css';
export interface FormBuilderProps {
    transferTarget?: HTMLElement | null;
    local?: boolean;
    integrations?: {
        id: string;
        label: string;
        provider: string;
        configured: boolean;
    }[];
    postTypes?: {
        id: string;
        label: string;
    }[];
    payments?: PaymentAvailability;
    resources?: {
        id: string;
        label: string;
    }[];
    value: FormDefinition;
    onChange: (value: FormDefinition) => void;
    readOnly?: boolean;
    saveStatus?: string;
    onSave?: () => void;
    onPublish?: () => void;
    children?: React.ReactNode;
}
export declare function FormBuilder({ transferTarget, value, onChange, readOnly, saveStatus, onSave, onPublish, children, resources, payments, postTypes, integrations, local }: FormBuilderProps): import("react/jsx-runtime").JSX.Element;
