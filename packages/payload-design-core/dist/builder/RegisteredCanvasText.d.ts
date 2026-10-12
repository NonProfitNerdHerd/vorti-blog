import { type ContentNode } from '../content/model';
/** Resolve an existing host content editor; no extra rich-text field or storage is created. */
export declare function RegisteredCanvasText({ node, disabled, change, }: {
    node: ContentNode;
    disabled: boolean;
    change: (patch: Partial<ContentNode>) => void;
}): import("react/jsx-runtime").JSX.Element;
