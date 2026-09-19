import type { BlockRegistration, DesignPrimitive, FieldDefinition } from '../types';
export declare const heroBoardFields: FieldDefinition[];
export declare const heroBoardRegistration: BlockRegistration;
export declare const heroBoardSample: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCTA: {
        label: string;
        url: string;
    };
};
export declare const heroBoardDesigns: Array<{
    name: string;
    slug: string;
    design: DesignPrimitive;
}>;
