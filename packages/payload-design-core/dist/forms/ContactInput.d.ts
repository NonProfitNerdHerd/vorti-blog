import type { FieldInputProps } from './FormRenderer';
export declare function ContactInput({ field, value, onChange, id, disabled, build, selectedComponent, selectComponent, resizeComponent }: FieldInputProps & {
    build?: boolean;
    selectedComponent?: string;
    selectComponent?: (key: string) => void;
    resizeComponent?: (key: string, width: number) => void;
}): import("react/jsx-runtime").JSX.Element;
