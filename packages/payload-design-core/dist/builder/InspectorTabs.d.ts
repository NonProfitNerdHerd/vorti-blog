import './inspector-tabs.css';
export declare function InspectorTabs({ value, onChange, documentLabel, onExpand, }: {
    value: 'block' | 'document';
    onChange: (value: 'block' | 'document') => void;
    documentLabel: string;
    onExpand?: () => void;
}): import("react/jsx-runtime").JSX.Element;
