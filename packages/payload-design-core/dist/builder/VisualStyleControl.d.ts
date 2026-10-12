export declare function PaintControl({ label, value, update, gradient, }: {
    label: string;
    value: string;
    update: (v: string) => void;
    gradient?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export declare const expandSides: (value: string) => string[];
export declare function FocalPoint({ url, value, update, }: {
    url?: string;
    value: string;
    update: (value: string) => void;
}): import("react/jsx-runtime").JSX.Element;
export declare function VisualStyleControl({ name, value, inherited, update, values, updateMany, inheritedValues, responsive, state, setState, }: {
    name: string;
    value: string;
    inherited?: string;
    update: (v: string) => void;
    values: Record<string, string | undefined>;
    inheritedValues: Record<string, string | undefined>;
    updateMany: (patch: Record<string, string>) => void;
    responsive?: boolean;
    state: string;
    setState?: (v: 'normal' | 'hover' | 'focus') => void;
}): import("react/jsx-runtime").JSX.Element;
