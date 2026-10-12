import type { ContentNode } from '../content/model';
export declare function SaveReusableView({ node, onChange, disabled, }: {
    node: ContentNode;
    onChange: (patch: Partial<ContentNode>) => void;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element;
