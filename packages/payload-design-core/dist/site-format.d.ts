export type SiteFormat = {
    timezone?: string | null;
    dateFormat?: string | null;
    timeFormat?: string | null;
};
export declare const dateFormats: {
    value: string;
    label: string;
}[];
export declare const timeFormats: {
    value: string;
    label: string;
}[];
export declare function formatSiteDate(input: string | Date, settings?: SiteFormat, zone?: string): string;
export declare function formatSiteTime(input: string | Date, settings?: SiteFormat, zone?: string): string;
