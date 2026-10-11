import { type ReactNode } from 'react';
import type { ContentNode } from '../content/model';
export default function InteractiveBlock({ node, children, editing, }: {
    node: ContentNode;
    children?: ReactNode;
    editing?: boolean;
}): import("react/jsx-runtime").JSX.Element | null;
