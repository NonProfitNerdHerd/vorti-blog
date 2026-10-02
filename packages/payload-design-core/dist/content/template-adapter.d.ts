import type { Template, BlockType, BlockDesign } from '../types';
import { type ContentNode } from './model';
export declare function readPath(source: Record<string, unknown>, path: string): unknown;
export declare function templateContentNodes(template: Template, document: Record<string, unknown>, types: BlockType[], designs: BlockDesign[], includeUnplacedFields?: boolean): ContentNode[];
