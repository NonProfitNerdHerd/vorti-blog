import type { Payload, PayloadRequest } from 'payload';
import type { DependencySource } from './dependencies';
import type { DesignStore } from './resolver';
type QueryClient = Pick<Payload, 'find' | 'findByID'>;
export declare function createPayloadDesignStore(payload: QueryClient, req?: PayloadRequest): DesignStore;
export declare function createPayloadDependencySource(payload: QueryClient, contentCollections: string[], req?: PayloadRequest): DependencySource;
export {};
