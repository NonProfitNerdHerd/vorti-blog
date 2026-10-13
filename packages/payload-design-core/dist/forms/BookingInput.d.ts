import type { FormField } from './model';
export interface BookingOption {
    id: string;
    startsAt: string;
    endsAt: string;
    remaining: number;
}
export interface BookingSelection {
    token: string;
    expiresAt: string;
    startsAt: string;
    endsAt: string;
    slot: string;
}
export interface BookingAdapter {
    load: (field: FormField, from: string, to: string) => Promise<BookingOption[]>;
    reserve: (field: FormField, path: string, slot: string) => Promise<BookingSelection>;
    release: (field: FormField, path: string) => Promise<void>;
    selected?: (path: string) => BookingSelection | undefined;
}
export declare function BookingInput({ field, path, id, value, disabled, adapter, onChange }: {
    field: FormField;
    path: string;
    id: string;
    value?: string;
    disabled?: boolean;
    adapter?: BookingAdapter;
    onChange: (value: string) => void;
}): import("react/jsx-runtime").JSX.Element;
