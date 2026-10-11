import { type ReactNode } from 'react';
import './template-builder.css';
export type SiteShellRegion = 'header' | 'footer';
export declare function SiteTemplateBuilder(): import("react/jsx-runtime").JSX.Element;
export declare function SiteShellBuilder({ region, navigation, }: {
    region: SiteShellRegion;
    navigation?: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
