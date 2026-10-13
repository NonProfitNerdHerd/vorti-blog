import { type FormDefinition } from './model';
export interface PaymentAvailability {
    stripe: boolean;
    simulator: boolean;
}
export declare function PaymentSettings({ definition, onChange, availability }: {
    definition: FormDefinition;
    onChange: (value: FormDefinition) => void;
    availability?: PaymentAvailability;
}): import("react/jsx-runtime").JSX.Element;
