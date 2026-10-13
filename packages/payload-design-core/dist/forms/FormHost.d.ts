/** Reusable public placement. Each instance owns its session and retry key. Answers are never put in browser storage. */
export declare function FormHost({ slug, embedded }: {
    slug: string;
    embedded?: boolean;
}): import("react/jsx-runtime").JSX.Element;
