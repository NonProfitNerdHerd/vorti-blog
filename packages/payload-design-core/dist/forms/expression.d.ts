import type { Answers } from './model';
type Node = {
    kind: 'number';
    value: number;
} | {
    kind: 'field';
    id: string;
} | {
    kind: 'unary';
    op: string;
    child: Node;
} | {
    kind: 'binary';
    op: string;
    left: Node;
    right: Node;
} | {
    kind: 'call';
    name: string;
    args: Node[];
};
export declare function parseExpression(source: string): Node;
export declare function expressionReferences(source: string): string[];
export declare function calculate(source: string, answers: Answers): number;
export {};
