import type { Access, Field, Plugin } from 'payload';
import type { BlockRegistration, DesignEventHandler } from './types';
export type DesignSystemOptions = {
    enabled?: boolean;
    blockCreator?: boolean;
    templates?: boolean;
    templatableCollections?: string[];
    blockPacks?: BlockRegistration[];
    canManage?: Access;
    isDesignManager?: (user: unknown) => boolean;
    onPublish?: DesignEventHandler;
    lexicalSchemaPaths?: Record<string, string>;
};
export declare function findLexicalSchemaPath(fields: Field[], parentSchemaPath: string, parentIndexPath?: string): string | undefined;
export declare function designSystemPlugin(options?: DesignSystemOptions): Plugin;
