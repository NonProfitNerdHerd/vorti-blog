import type { DateRestrictions } from './model';
export declare function DateSettings({ value, kind, onChange, resources }: {
    value?: DateRestrictions;
    kind: string;
    resources?: {
        id: string;
        label: string;
    }[];
    onChange: (value: DateRestrictions) => void;
}): import("react/jsx-runtime").JSX.Element;
