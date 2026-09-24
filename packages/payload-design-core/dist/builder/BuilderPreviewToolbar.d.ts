import type { BuilderPreviewSize, BuilderViewport } from './contracts';
export declare const BUILDER_PREVIEW_SIZES: Record<BuilderViewport, BuilderPreviewSize>;
export declare function BuilderPreviewToolbar({ value, onChange }: {
    value: BuilderViewport;
    onChange: (value: BuilderViewport) => void;
}): import("react/jsx-runtime").JSX.Element;
export declare function BuilderPreviewFrame({ children, viewport }: {
    children: React.ReactNode;
    viewport: BuilderViewport;
}): import("react/jsx-runtime").JSX.Element;
