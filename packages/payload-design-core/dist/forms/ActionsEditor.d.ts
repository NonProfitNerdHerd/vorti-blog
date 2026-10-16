import { type PaymentAvailability } from './PaymentSettings';
import { type FormDefinition } from './model';
export declare function ActionsEditor({ mode, definition, onChange, disabled, integrations, local, payments, postTypes }: {
    mode?: 'all' | 'email' | 'other';
    definition: FormDefinition;
    onChange: (value: FormDefinition) => void;
    disabled?: boolean;
    local?: boolean;
    payments?: PaymentAvailability;
    postTypes?: {
        id: string;
        label: string;
    }[];
    integrations?: {
        id: string;
        label: string;
        provider: string;
        configured: boolean;
    }[];
}): import("react/jsx-runtime").JSX.Element;
