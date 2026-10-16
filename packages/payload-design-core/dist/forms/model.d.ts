/** Versioned public-safe contracts. Secrets belong to application integration records. */
export type FormValue = null | string | number | boolean | FormValue[] | {
    [key: string]: FormValue;
};
export type Answers = Record<string, FormValue>;
export type FieldKind = 'text' | 'textarea' | 'name' | 'email' | 'phone' | 'url' | 'address' | 'number' | 'currency' | 'slider' | 'select' | 'searchSelect' | 'radio' | 'checkbox' | 'multiSelect' | 'imageChoice' | 'date' | 'time' | 'datetime' | 'dateRange' | 'upload' | 'hidden' | 'calculated' | 'rating' | 'nps' | 'likert' | 'ranking' | 'signature' | 'repeater' | 'consent' | 'terms' | 'heading' | 'content' | 'divider' | 'section' | 'row' | 'step' | 'review';
export type Operator = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'in' | 'notIn' | 'empty' | 'notEmpty' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after';
export type Condition = {
    all: Condition[];
} | {
    any: Condition[];
} | {
    field: string;
    operator: Operator;
    value?: FormValue;
    compareField?: string;
};
export type RuleEffect = {
    kind: 'visible' | 'enabled' | 'required';
    target: string;
    value: boolean;
} | {
    kind: 'set';
    target: string;
    value: FormValue;
} | {
    kind: 'clear';
    target: string;
} | {
    kind: 'style';
    target: string;
    value: 'highlight' | 'muted' | 'warning' | 'success';
} | {
    kind: 'route';
    target: string;
} | {
    kind: 'confirmation';
    message: string;
} | {
    kind: 'action';
    target: string;
};
export interface FormRule {
    id: string;
    name: string;
    when: Condition;
    effects: RuleEffect[];
}
export interface FormOption {
    id: string;
    label: string;
    value: string;
    image?: string;
}
export interface DateRestrictions {
    min?: string;
    max?: string;
    minDaysFromToday?: number;
    maxDaysFromToday?: number;
    excludedWeekdays?: number[];
    blackoutDates?: string[];
    allowedRanges?: {
        start: string;
        end: string;
    }[];
    leadMinutes?: number;
    businessHours?: {
        weekday: number;
        start: string;
        end: string;
    }[];
    incrementMinutes?: number;
    timezone?: string;
    resource?: string;
}
export interface FormField {
    buttons?: {
        id: string;
        label: string;
        event: 'next' | 'back' | 'submit' | 'custom';
    }[];
    blockLabel?: string;
    widthFraction?: number;
    contact?: {
        format: 'full' | 'firstLast' | 'middleInitial' | 'middle' | 'us' | 'international';
        line2?: boolean;
    };
    components?: Record<string, {
        label?: string;
        help?: string;
        placeholder?: string;
        widthFraction?: number;
    }>;
    id: string;
    kind: FieldKind | (string & {});
    label: string;
    help?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: FormValue;
    sensitive?: boolean;
    disabled?: boolean;
    width?: 3 | 4 | 6 | 8 | 9 | 12;
    children?: FormField[];
    options?: FormOption[];
    layout?: {
        kind: 'columns';
        width?: 'inherit' | 'content' | 'full';
    } | {
        kind: 'column';
        weight: number;
    };
    rows?: FormOption[];
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    minChoices?: number;
    maxChoices?: number;
    errorMessage?: string;
    expression?: string;
    currency?: string;
    precision?: number;
    date?: DateRestrictions;
    files?: {
        maxCount: number;
        maxBytes: number;
        mimeTypes: string[];
    };
    prefill?: {
        source: 'profile' | 'query';
        key: string;
    };
    choiceSource?: {
        collection: string;
        labelField: string;
        valueField: string;
    };
    group?: {
        id: string;
        mode: 'copy' | 'linked';
        revision: string;
    };
}
export interface FormAction {
    id: string;
    kind: string;
    name: string;
    when?: Condition;
    requiresPayment?: boolean;
    config: Record<string, FormValue>;
}
export interface FormTheme {
    font: 'inherit' | 'sans-serif' | 'serif';
    primary: string;
    background: string;
    text: string;
    border: string;
    error: string;
    radius: number;
    spacing: number;
    size: 'compact' | 'regular' | 'large';
    labelPosition: 'above' | 'beside';
    progress: 'bar' | 'steps';
    buttonLabel: string;
}
export interface FormDefinition {
    graph?: import('./graph').FormGraph;
    workflow?: import('./workflow').EntryWorkflow;
    version: 1;
    mode: 'standard' | 'steps' | 'conversational';
    locale: string;
    direction: 'ltr' | 'rtl';
    fields: FormField[];
    rules: FormRule[];
    actions: FormAction[];
    theme: FormTheme;
    confirmation: string;
    redirect?: string;
    access: {
        authenticated: boolean;
        origins: string[];
        embedOrigins: string[];
        turnstile: boolean;
        saveProgress: boolean;
        autosaveProgress: boolean;
        draftDays: number;
        analytics: boolean;
        analyticsConsent: boolean;
        publicResults: boolean;
        retentionDays: number;
        ratePerMinute: number;
    };
    payment?: {
        provider: 'stripe' | 'simulator';
        amountField: string;
        currency: string;
    };
}
export interface FormIssue {
    path: string;
    message: string;
    field?: string;
    rule?: string;
    action?: string;
}
export declare const defaultTheme: FormTheme;
export declare const emptyDefinition: () => FormDefinition;
export declare function flattenFields(fields: FormField[]): FormField[];
export declare function makeID(prefix?: string): string;
export declare const isEmpty: (value: unknown) => boolean;
export declare function answerFields(fields: FormField[], answers: Answers, prefix?: string): {
    field: FormField;
    value: FormValue | undefined;
    path: string;
}[];
export declare function attachmentReferences(fields: FormField[], answers: Answers): {
    field: FormField;
    references: string[];
    path: string;
}[];
