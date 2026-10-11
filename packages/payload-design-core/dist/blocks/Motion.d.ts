import type { BlockPresentation } from './presentation';
export default function Motion({ id, motion, }: {
    id: string;
    motion: NonNullable<BlockPresentation['motion']>;
}): null;
export declare function previewBlockMotion(id: string, motion: NonNullable<BlockPresentation['motion']>): void;
