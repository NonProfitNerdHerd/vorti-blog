import type { EventSchedule, Occurrence } from './model';
/** Reject ambiguous or nonexistent user-entered wall times rather than silently shifting them. */
export declare function eventInstant(value: string, zone: string, strict?: boolean): number;
export declare function validateSchedule(s: EventSchedule): void;
export declare function expandSchedule(s: EventSchedule, from: number, to: number, seriesID: string): Occurrence[];
