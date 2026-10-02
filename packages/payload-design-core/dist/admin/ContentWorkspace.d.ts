import React from 'react';
import type { GroupFieldClientComponent } from 'payload';
import './content-workspace.css';
type Extras = {
    groups: Record<string, string[]>;
    lexicalSchemaPath: string;
};
export declare const ContentWorkspace: (props: React.ComponentProps<GroupFieldClientComponent> & Extras) => import("react/jsx-runtime").JSX.Element;
export {};
