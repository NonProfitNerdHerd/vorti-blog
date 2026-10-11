import { type RefObject } from 'react';
import type { SidebarAdapter, SidebarState } from './BuilderSidebar';
import { type SidebarNode } from './sidebar-model';
import './block-actions.css';
export declare function BlockActionMenu({ node, adapter, state, }: {
    node: SidebarNode;
    adapter: SidebarAdapter;
    state: SidebarState;
}): import("react/jsx-runtime").JSX.Element | null;
/** Lives with the adapter, including when the hierarchy panel is closed. */
export declare function SelectedBlockToolbar({ adapter, state, scope, }: {
    adapter: SidebarAdapter;
    state: SidebarState;
    scope: RefObject<HTMLDivElement | null>;
}): import("react").ReactPortal | null;
