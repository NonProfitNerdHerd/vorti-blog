import './template-builder.css';
export type SiteShellRegion = 'header' | 'footer';
export declare function SiteTemplateBuilder(): import("react/jsx-runtime").JSX.Element;
export declare function SiteShellBuilder({ region }: {
    region: SiteShellRegion;
}): import("react/jsx-runtime").JSX.Element;
