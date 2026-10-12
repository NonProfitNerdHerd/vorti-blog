export type BlockListItem = {
    label: string;
    url?: string;
    icon?: string;
};
export declare function blockItems(value: unknown, social?: boolean): BlockListItem[];
