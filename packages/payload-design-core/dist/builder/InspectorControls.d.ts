import { type ReactNode } from 'react';
import type { Viewport } from '../content/model';
export declare const InspectorDevice: import("react").Context<{
    viewport: Viewport;
    change: (device: Viewport) => void;
} | null>;
export declare const InspectorGesture: {
    active: boolean;
    changed: boolean;
    pending: boolean;
};
export declare function markInspectorGesture(): void;
export declare function beginInspectorGesture(): void;
export declare function endInspectorGesture(): void;
export declare function InspectorIcon({ name }: {
    name: string;
}): import("react/jsx-runtime").JSX.Element;
export declare function IconButton({ label, icon, onClick, pressed, disabled, }: {
    label: string;
    icon: string;
    onClick: () => void;
    pressed?: boolean;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export declare function InspectorToggle({ open, change, }: {
    open: boolean;
    change: (open: boolean) => void;
}): import("react/jsx-runtime").JSX.Element;
export declare function Popover({ label, trigger, children, }: {
    label: string;
    trigger: ReactNode;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function DeviceControl({ label }: {
    label: string;
}): import("react/jsx-runtime").JSX.Element | null;
export declare function DimensionControl({ label, value, update, units, negative, }: {
    label: string;
    value: string;
    update: (v: string) => void;
    units?: string[];
    negative?: boolean;
}): import("react/jsx-runtime").JSX.Element;
