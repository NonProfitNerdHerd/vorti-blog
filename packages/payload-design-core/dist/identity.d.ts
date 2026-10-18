export type AttributionUser = {
    username?: string | null;
    email?: string | null;
    displayName?: string | null;
    attributionPreference?: 'username' | 'email' | null;
    attributionLabel?: string | null;
    profilePublic?: boolean | null;
};
/** Legacy callers supply their previous fallback; opted-in accounts share one identity. */
export declare function userIdentity(user: AttributionUser | null | undefined, legacy?: string | null): string;
export declare function publicAuthorIdentity(user: AttributionUser | null | undefined): string;
