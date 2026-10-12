import { type ReactNode } from 'react';
export declare function SetupWizard({ steps, current, onChange, children, canAdvance, canVisit, issueSteps, }: {
    steps: string[];
    current: number;
    onChange: (step: number) => void;
    children: ReactNode;
    canAdvance?: boolean;
    canVisit?: (step: number) => boolean;
    issueSteps?: number[];
}): import("react/jsx-runtime").JSX.Element;
