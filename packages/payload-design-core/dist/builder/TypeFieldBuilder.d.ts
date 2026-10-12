import { type ReactNode } from 'react';
import type { TypeField } from '../views/model';
export declare const typeFieldDescriptions: Record<TypeField['kind'], string>;
export declare function nextFieldID(fields: TypeField[], label: string): string;
export declare function TypeFieldBuilder({ fields, onChange, savedFields, disabled, preview, renderDefault, }: {
    fields: TypeField[];
    onChange: (fields: TypeField[]) => void;
    savedFields: TypeField[];
    disabled?: boolean;
    preview: ReactNode;
    renderDefault?: (field: TypeField, change: (value: unknown) => void) => ReactNode;
}): import("react/jsx-runtime").JSX.Element;
