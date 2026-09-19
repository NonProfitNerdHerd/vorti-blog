import type { ID } from './types';
export type DependencySource = {
    templatesUsingDesign(id: ID): Promise<Array<{
        id: ID;
        name: string;
    }>>;
    contentUsingTemplate(id: ID): Promise<Array<{
        collection: string;
        id: ID;
        status?: string;
    }>>;
};
export declare function getTemplateDependencies(source: DependencySource, templateId: ID): Promise<{
    collection: string;
    id: ID;
    status?: string;
}[]>;
export declare function getBlockDesignDependencies(source: DependencySource, designId: ID): Promise<{
    templates: {
        id: ID;
        name: string;
    }[];
    content: {
        collection: string;
        id: ID;
        status?: string;
    }[];
}>;
export declare function assertDesignCanDelete(source: DependencySource, designId: ID): Promise<void>;
export declare function assertTemplateCanDelete(source: DependencySource, templateId: ID): Promise<void>;
