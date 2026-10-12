import type { ContentNode } from '../content/model';
import './variations-editor.css';
export declare function VariationPicker({ node, onChange, onDone, initial, disabled, }: {
    node: ContentNode;
    onChange: (node: ContentNode) => void;
    onDone?: () => void;
    initial?: boolean;
    disabled?: boolean;
}): import("react/jsx-runtime").JSX.Element | null;
