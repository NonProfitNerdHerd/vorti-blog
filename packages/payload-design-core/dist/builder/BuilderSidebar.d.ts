import type { BuilderDragItem } from './BuilderCore';
import { type InsertionTarget, type SidebarNode } from './sidebar-model';
import './builder-sidebar.css';
export type SidebarItem = BuilderDragItem & {
    category: string;
    keywords?: string[];
};
export type SidebarMode = 'list' | 'outline' | 'blocks';
export declare function useBuilderSidebar(identity?: string): {
    open: boolean;
    setOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    mode: SidebarMode;
    setMode: import("react").Dispatch<import("react").SetStateAction<SidebarMode>>;
    target: InsertionTarget | undefined;
    rememberOpener: (button: HTMLButtonElement) => void;
    close: () => void;
    insert: (destination?: InsertionTarget) => void;
    inserted: () => void;
};
export type SidebarState = ReturnType<typeof useBuilderSidebar>;
export declare function SidebarControls({ state, canInsert, }: {
    state: SidebarState;
    canInsert?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export type SidebarAdapter = {
    nodes: SidebarNode[];
    selected?: string;
    items: SidebarItem[];
    canEdit: boolean;
    locked?: boolean;
    onSelect: (id: string) => void;
    onInsert: (item: SidebarItem, target: InsertionTarget) => void;
    onMove: (id: string, target: InsertionTarget) => void;
    onDuplicate?: (id: string) => void;
    onDelete?: (id: string) => void;
};
export declare function BuilderSidebar({ state, adapter, }: {
    state: SidebarState;
    adapter: SidebarAdapter;
}): import("react/jsx-runtime").JSX.Element;
