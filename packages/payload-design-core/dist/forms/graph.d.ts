import { type Answers, type Condition, type FormDefinition, type FormValue } from './model';
export type GraphKind = 'start' | 'canvas' | 'if' | 'switch' | 'set' | 'message' | 'submit' | 'email' | 'cms' | 'http' | 'end';
export interface GraphNode {
    id: string;
    kind: GraphKind;
    name: string;
    canvas?: string;
    condition?: Condition;
    field?: string;
    cases?: {
        id: string;
        label: string;
        value: FormValue;
    }[];
    target?: string;
    variable?: boolean;
    source?: string;
    value?: FormValue;
    clear?: boolean;
    message?: string;
    config?: Record<string, string>;
}
export interface GraphEdge {
    id: string;
    source: string;
    output: string;
    target: string;
}
export interface FormGraph {
    version: 1;
    enabled: boolean;
    nodes: GraphNode[];
    edges: GraphEdge[];
    positions: Record<string, {
        x: number;
        y: number;
    }>;
}
export interface GraphEvent {
    node: string;
    output: string;
}
export interface GraphRun {
    node?: GraphNode;
    answers: Answers;
    assignments: Answers;
    variables: Answers;
    canvases: string[];
    edges: string[];
    log: string[];
    error?: string;
}
export declare const graphKinds: GraphKind[];
export declare const graphNames: Record<GraphKind, string>;
export declare function canvasButtons(definition: FormDefinition, id?: string): {
    id: string;
    label: string;
    event: "next" | "back" | "submit" | "custom";
}[];
export declare function graphOutputs(node: GraphNode, definition: FormDefinition): {
    id: string;
    label: string;
}[];
export declare function graphShape(value: unknown): value is FormGraph;
export declare function graphIssues(definition: FormDefinition): {
    node?: string;
    message: string;
}[];
export declare function graphPayload(node: GraphNode, answers: Answers, variables: Answers): {
    [k: string]: string;
};
/** Pure bounded interpreter. Clients may retry a failure path, but cannot assert acceptance.
 * A retry still validates every visited canvas; a failure event grants no exemptions. */
export declare function runGraph(definition: FormDefinition, raw: Answers, events: GraphEvent[], outcomes?: boolean): GraphRun;
export declare function graphScope(definition: FormDefinition, run: GraphRun): FormDefinition;
/** Discard only known inactive answers. Unknown submitted keys still reach normal validation. */
export declare function graphAnswers(definition: FormDefinition, scoped: FormDefinition, answers: Answers): Answers;
