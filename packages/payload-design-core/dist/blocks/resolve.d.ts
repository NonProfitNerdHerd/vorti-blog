import { type ContentNode } from '../content/model';
export type ListingItem = {
    title: string;
    url: string;
    excerpt?: string;
    publishedAt?: string;
    image?: string;
    taxonomy?: string;
};
export type ListingResult = {
    results: ListingItem[];
    page: number;
    totalPages: number;
};
export type BlockResolveContext = {
    document: Record<string, unknown>;
    now?: number;
    preview?: boolean;
    list?: (props: Record<string, unknown>, page: number) => Promise<ListingResult>;
};
export declare function resolveBlocks(source: ContentNode[], context: BlockResolveContext): Promise<ContentNode[]>;
