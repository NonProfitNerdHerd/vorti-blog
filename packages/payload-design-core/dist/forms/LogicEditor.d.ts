import { type Condition, type FormDefinition, type FormField } from './model';
export declare function ConditionEditor({ condition, fields, onChange, disabled }: {
    condition: Condition;
    fields: FormField[];
    onChange: (value: Condition) => void;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export declare function LogicEditor({ definition, onChange, disabled }: {
    definition: FormDefinition;
    onChange: (value: FormDefinition) => void;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
