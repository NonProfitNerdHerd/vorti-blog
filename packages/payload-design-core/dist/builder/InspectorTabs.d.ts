import './inspector-tabs.css';
export type InspectorTab = 'block' | 'document' | 'seo';
export declare function InspectorTabs({ value, onChange, documentLabel, onExpand, seo, }: {
    value: InspectorTab;
    onChange: (value: InspectorTab) => void;
    documentLabel: string;
    onExpand?: () => void;
    seo?: boolean;
}): import("react/jsx-runtime").JSX.Element;
