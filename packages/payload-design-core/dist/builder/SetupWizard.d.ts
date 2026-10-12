import { type ReactNode } from 'react';
export declare function SetupWizard({ steps, current, onChange, children, canAdvance, canVisit, }: {
    steps: string[];
    current: number;
    onChange: (step: number) => void;
    children: ReactNode;
    canAdvance?: boolean;
    canVisit?: (step: number) => boolean;
}): import("react/jsx-runtime").JSX.Element;
