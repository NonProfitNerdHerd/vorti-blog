export declare function SavedDrafts({ slug, refresh, onResume, onRevoke }: {
    slug: string;
    refresh: string;
    onResume: (id: number) => Promise<boolean>;
    onRevoke: (id: number) => Promise<string>;
}): import("react/jsx-runtime").JSX.Element | null;
