import { type SeparatorSettings } from './Separator';
export type Rule = {
    field: string;
    operator: 'equals' | 'notEquals' | 'empty' | 'notEmpty' | 'contains';
    value?: string;
};
export type BackgroundSettings = {
    mode?: 'solid' | 'gradient' | 'image';
    mediaID?: string | number;
    imageURL?: string;
    fit?: 'cover' | 'contain' | 'auto';
    position?: string;
    repeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
    overlay?: string;
    gradient?: string;
    blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
    opacity?: number;
};
export type BlockPresentation = {
    media?: {
        zoom?: number;
        brightness?: number;
        contrast?: number;
        saturation?: number;
        grayscale?: number;
        blur?: number;
        shape?: 'none' | 'circle' | 'ellipse' | 'rounded' | 'blob' | 'diagonal';
    };
    separators?: {
        top?: SeparatorSettings;
        bottom?: SeparatorSettings;
    };
    background?: BackgroundSettings & {
        responsive?: Partial<Record<'tablet' | 'mobile', BackgroundSettings>>;
    };
    tag?: 'div' | 'section' | 'article' | 'aside' | 'figure';
    className?: string;
    attributes?: Record<string, string>;
    css?: string;
    hidden?: Partial<Record<'desktop' | 'tablet' | 'mobile', boolean>>;
    hover?: Record<string, string>;
    focus?: Record<string, string>;
    link?: {
        url?: string;
        newTab?: boolean;
        rel?: string;
        title?: string;
        lightbox?: boolean;
    };
    condition?: {
        match: 'all' | 'any';
        rules: Rule[];
        start?: string;
        end?: string;
    };
    motion?: {
        trigger: 'entrance' | 'scroll';
        x?: number;
        y?: number;
        scale?: number;
        rotate?: number;
        skew?: number;
        opacity?: number;
        blur?: number;
        duration?: number;
        delay?: number;
        easing?: 'ease' | 'linear' | 'ease-in' | 'ease-out';
    };
};
export declare function resolveBackground(background: BlockPresentation['background'], device?: 'desktop' | 'tablet' | 'mobile'): BackgroundSettings;
export declare const publicDocumentFields: string[];
/** Host applications opt in additional publicly renderable fields in a shared server/admin entry. */
export declare function registerPublicDocumentField(path: string): void;
export declare function readPublicDocumentField(document: Record<string, unknown>, path: string): unknown;
export declare function conditionVisible(condition: BlockPresentation['condition'], document: Record<string, unknown>, now?: number): boolean;
/** A deliberately restricted CSS grammar: declarations, &-anchored rules, and media queries. */
export declare function compileBlockCSS(input: string | undefined, selector: string): string;
export declare function validatePresentation(value: BlockPresentation | undefined): string | undefined;
