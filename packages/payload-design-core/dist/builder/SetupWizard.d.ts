import { type ReactNode } from 'react';
export declare function SetupWizard({ steps, current, onChange, children, }: {
    steps: string[];
    current: number;
    onChange: (step: number) => void;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
