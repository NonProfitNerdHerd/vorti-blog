import { type ReactNode } from 'react';
import type { TypeField, TypeFieldKind } from '../views/model';
export declare const typeFieldDescriptions: Record<TypeField['kind'], string>;
export declare function nextFieldID(fields: TypeField[], label: string): string;
export declare function TypeFieldBuilder({ fields, onChange, savedFields, disabled, preview, renderDefault, requiredKinds, serverError, }: {
    fields: TypeField[];
    onChange: (fields: TypeField[]) => void;
    savedFields: TypeField[];
    disabled?: boolean;
    preview: ReactNode;
    renderDefault?: (field: TypeField, change: (value: unknown) => void) => ReactNode;
    requiredKinds?: TypeFieldKind[];
    serverError?: string;
}): import("react/jsx-runtime").JSX.Element;
