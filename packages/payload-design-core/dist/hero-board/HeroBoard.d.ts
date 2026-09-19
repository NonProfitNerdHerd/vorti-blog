import type { DesignPrimitive } from '../types';
import './hero-board.css';
export type HeroMedia = {
    url: string;
    alt: string;
};
export type HeroBoardValues = {
    eyebrow?: string;
    headline: string;
    subheadline?: string;
    backgroundImage?: HeroMedia;
    foregroundImage?: HeroMedia;
    primaryCTA?: {
        label: string;
        url: string;
    };
    secondaryCTA?: {
        label: string;
        url: string;
    };
};
export declare function HeroBoardRenderer({ design, values, headingLevel }: {
    design: DesignPrimitive;
    values: HeroBoardValues;
    headingLevel?: 1 | 2 | 3;
}): import("react/jsx-runtime").JSX.Element;
