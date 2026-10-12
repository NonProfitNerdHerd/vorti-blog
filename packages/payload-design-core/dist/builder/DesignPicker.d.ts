import type { DesignPrimitive, ID } from '../types';
export type PublishedDesign = {
    id: ID;
    name: string;
    blockType: ID;
    design?: DesignPrimitive;
    primitives?: DesignPrimitive;
};
export declare function orderedDesigns(designs: PublishedDesign[], type: ID): PublishedDesign[];
/** Visual structural previews use the same published primitives as rendering. */
export declare function DesignPicker({ designs, value, onChange, onDone, }: {
    designs: PublishedDesign[];
    value?: ID;
    onChange: (id: ID) => void;
    onDone?: () => void;
}): import("react/jsx-runtime").JSX.Element;
