import { type ViewConfig, type ViewResult } from './model';
import './views.css';
export declare function ViewThumbnail({ kind }: {
    kind: string;
}): import("react/jsx-runtime").JSX.Element;
export declare function DynamicView({ viewID, initial, configuration, editing, }: {
    viewID?: string | number;
    initial?: ViewResult;
    configuration?: ViewConfig;
    editing?: boolean;
}): import("react/jsx-runtime").JSX.Element;
