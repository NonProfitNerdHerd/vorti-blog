/** Wall-clock conversion with explicit DST handling; never relies on the host timezone. */
export declare function zonedParts(instant: Date, timezone: string): string;
export declare function wallTimeToInstant(local: string, timezone: string, disambiguation?: 'earlier' | 'later' | 'reject'): string;
