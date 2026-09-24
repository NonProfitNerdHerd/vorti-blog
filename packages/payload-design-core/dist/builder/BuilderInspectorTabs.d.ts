export type BuilderInspectorTab = 'settings' | 'style' | 'advanced';
export declare function BuilderInspectorTabs({ active, onChange, settingsLabel }: {
    active: BuilderInspectorTab;
    onChange: (tab: BuilderInspectorTab) => void;
    settingsLabel?: string;
}): import("react/jsx-runtime").JSX.Element;
