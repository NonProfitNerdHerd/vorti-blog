/** Serializable contracts shared by editors, servers, and source adapters. */
import type { ContentNode } from '../content/model';
import type { ReactNode } from 'react';
export type TypeFieldKind = 'text' | 'textarea' | 'richText' | 'number' | 'date' | 'boolean' | 'select' | 'media' | 'url' | 'relationship' | 'eventSchedule';
export type TypeField = {
    id: string;
    label: string;
    kind: TypeFieldKind;
    required?: boolean;
    public?: boolean;
    helpText?: string;
    options?: string[];
    relationTo?: string;
    defaultValue?: unknown;
    rules?: FieldRule[];
};
export type FieldRule = {
    kind: 'requiredWhen' | 'minLength' | 'maxLength' | 'email' | 'containsEmail' | 'contains' | 'excludes' | 'min' | 'max' | 'integer' | 'compare' | 'earliest' | 'latest' | 'protocols' | 'domains' | 'checked' | 'mimeTypes' | 'maxBytes';
    value?: string | number | boolean;
    field?: string;
    operator?: 'equals' | 'set' | 'empty' | 'before' | 'after';
    allowEqual?: boolean;
    message?: string;
};
export type PostTypeDefinition = {
    id: string | number;
    key: string;
    singular: string;
    plural: string;
    prefix: string;
    icon: string;
    capability: string;
    fieldDefinitions: TypeField[];
    templates?: Array<string | number>;
    defaultTemplate?: string | number;
    archived?: boolean;
    schemaVersion: number;
};
export type EventSchedule = {
    start: string;
    end: string;
    timezone: string;
    allDay?: boolean;
    frequency?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
    weekdays?: number[];
    monthDays?: number[];
    until?: string;
    count?: number;
    exceptions?: Array<{
        date: string;
        cancelled?: boolean;
        start?: string;
        end?: string;
    }>;
};
export type Occurrence = {
    id: string;
    start: string;
    end: string;
    originalDate: string;
    allDay: boolean;
    timezone: string;
};
export type QueryRule = {
    field: 'categories' | 'tags' | 'author' | 'featured';
    operator: 'any' | 'all' | 'exclude';
    values: string[];
};
export type ViewQuery = {
    source: 'posts' | 'pages';
    match?: 'and' | 'or';
    rules?: QueryRule[];
    ids?: string[];
    excludeIDs?: string[];
    sort?: string;
    limit?: number;
    start?: string;
    end?: string;
};
export type ViewConfig = {
    version: 1;
    query: ViewQuery;
    layout: string;
    heading?: string;
    columns?: number;
    gap?: number;
    image?: boolean;
    excerpt?: boolean;
    taxonomy?: boolean;
    date?: boolean;
    author?: boolean;
    readingTime?: boolean;
    excerptLength?: number;
    search?: boolean;
    filters?: boolean;
    pagination?: 'numbers' | 'navigation' | 'more' | 'none';
    dialog?: boolean;
    background?: string;
    color?: string;
    radius?: number;
    timezone?: string;
    design?: Pick<ContentNode, 'styles' | 'presentation'>;
    responsiveColumns?: {
        tablet?: number;
        mobile?: number;
    };
};
export type SavedViewReference = {
    viewID: string | number;
};
export type ViewItem = {
    id: string;
    title: string;
    url: string;
    excerpt?: string;
    image?: string;
    date?: string;
    author?: string;
    readingTime?: number;
    categories?: Array<{
        id: string;
        name: string;
    }>;
    tags?: Array<{
        id: string;
        name: string;
    }>;
    occurrence?: Occurrence;
    location?: string;
    latitude?: number;
    longitude?: number;
};
export type ViewResult = {
    categoriesEnabled?: boolean;
    items: ViewItem[];
    page: number;
    totalPages: number;
    total: number;
    config: ViewConfig;
    facets?: {
        categories: Array<{
            id: string;
            name: string;
        }>;
        tags: Array<{
            id: string;
            name: string;
        }>;
    };
};
/** Assign consistent columns to connected groups of overlapping occurrences. */
export declare function occurrenceLanes(items: ViewItem[]): Map<string, {
    lane: number;
    lanes: number;
}>;
export type ContentSourceDefinition = {
    key: string;
    label: string;
    fields: string[];
    capabilities: string[];
};
export type ViewDefinition = {
    key: string;
    label: string;
    family: 'posts' | 'events';
    capability?: string;
    thumbnail: 'grid' | 'list' | 'split' | 'calendar' | 'slider' | 'map';
    render?: (props: {
        result: ViewResult;
        onSelect: (item: ViewItem) => void;
    }) => ReactNode;
};
export type ContentCapability = {
    key: string;
    label: string;
    requiredKinds?: TypeFieldKind[];
};
export declare function registerContentCapability(capability: ContentCapability): void;
export declare const listContentCapabilities: () => ContentCapability[];
export declare function registerContentSource(source: ContentSourceDefinition): void;
export declare function registerView(view: ViewDefinition): void;
export declare const listContentSources: () => ContentSourceDefinition[];
export declare const listViews: () => ViewDefinition[];
export declare const getView: (key: string) => ViewDefinition | undefined;
/** Named inserter entries remain central Saved View references after setup. */
export declare const viewBlockKind: (layout: string) => string;
export declare const viewForBlock: (kind: string) => ViewDefinition | undefined;
export declare const isViewPlacement: (kind: string) => boolean;
export declare const defaultView: ViewConfig;
export declare function documentURL(post: {
    slug?: string | null;
}): string;
