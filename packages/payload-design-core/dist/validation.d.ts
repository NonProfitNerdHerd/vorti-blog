import type { BlockType, FieldDefinition, TemplatedContent } from './types';
import type { DesignStore } from './resolver';
export type ValidationIssue = {
    path: string;
    message: string;
};
export declare function validateFieldDefinitions(fields: FieldDefinition[]): ValidationIssue[];
export declare function validateContentValues(type: Pick<BlockType, 'fields'>, values: unknown, requiredSection?: boolean): ValidationIssue[];
export declare function validateTemplatedContent(store: DesignStore, content: TemplatedContent): Promise<ValidationIssue[]>;
