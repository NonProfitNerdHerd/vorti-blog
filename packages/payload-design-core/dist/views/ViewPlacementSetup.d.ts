import { type ReactNode } from 'react';
import type { ContentNode } from '../content/model';
export declare function ViewPlacementSetup({ node, onChange, renderPicker, }: {
    node: ContentNode;
    onChange: (patch: Partial<ContentNode>) => void;
    renderPicker?: (collection: string, label: string, value: string, change: (value: string) => void) => ReactNode;
}): import("react/jsx-runtime").JSX.Element | null;
