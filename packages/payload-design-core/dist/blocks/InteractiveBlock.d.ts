import { type ReactNode } from 'react';
import type { ContentNode } from '../content/model';
export default function InteractiveBlock({ node, children, editing, viewport, }: {
    node: ContentNode;
    children?: ReactNode;
    editing?: boolean;
    viewport?: 'desktop' | 'tablet' | 'mobile';
}): import("react/jsx-runtime").JSX.Element | null;
