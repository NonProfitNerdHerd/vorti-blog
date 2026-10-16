import '@xyflow/react/dist/style.css';
import './graph.css';
import { type FormDefinition } from './model';
export declare function GraphEditor(props: {
    onCreateExample?: () => Promise<string>;
    definition: FormDefinition;
    onChange: (definition: FormDefinition) => void;
    disabled?: boolean;
    editCanvas: (id: string) => void;
}): import("react/jsx-runtime").JSX.Element;
