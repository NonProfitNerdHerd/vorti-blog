import type { BlockRegistration } from './types';
export declare function createBlockRegistry(entries?: BlockRegistration[]): {
    get: (slug: string) => BlockRegistration | undefined;
    list: () => BlockRegistration[];
};
export type RendererRegistry<Component> = Record<string, Component>;
export declare function createRendererRegistry<Component>(entries: RendererRegistry<Component>): {
    get(key: string): Component;
    keys: () => string[];
};
