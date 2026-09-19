import type { Access, Plugin } from 'payload';
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
};
export declare function designSystemPlugin(options?: DesignSystemOptions): Plugin;
