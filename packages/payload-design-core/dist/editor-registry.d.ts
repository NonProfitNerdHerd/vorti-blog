export type EditorElementCategory = 'text' | 'media' | 'layout' | 'data' | 'designed';
export type EditorElementKind = 'layout' | 'field' | 'block';
export type EditorElementDefinition = {
    kind: EditorElementKind;
    value: string;
    label: string;
    description: string;
    category: EditorElementCategory;
    keywords: string[];
    frequentlyUsed?: boolean;
    allowedParents?: Array<'root' | 'container' | 'row' | 'column' | 'stack'>;
};
export type EditorLibraryItem = Pick<EditorElementDefinition, 'kind' | 'value' | 'label'>;
export declare const coreEditorElements: EditorElementDefinition[];
export declare const editorCategoryLabels: Record<EditorElementCategory, string>;
export declare function toLibraryItem(definition: EditorElementDefinition): EditorLibraryItem;
export declare function searchEditorElements(elements: EditorElementDefinition[], query: string): EditorElementDefinition[];
