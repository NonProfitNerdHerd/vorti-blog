import type { Access, CollectionConfig } from 'payload';
import type { DesignEventHandler } from './types';
export type DesignCollectionsOptions = {
    contentCollections: string[];
    canManage?: Access;
    isDesignManager?: (user: unknown) => boolean;
    onPublish?: DesignEventHandler;
};
export declare function createDesignCollections(options: DesignCollectionsOptions): CollectionConfig[];
