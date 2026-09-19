export declare const slugs: {
    readonly blockTypes: "design-block-types";
    readonly blockDesigns: "design-block-designs";
    readonly templates: "design-templates";
};
export type ID = string | number;
export type Lifecycle = 'draft' | 'published' | 'archived';
export type FieldKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'media' | 'url' | 'date' | 'group';
export type FieldDefinition = {
    key: string;
    label: string;
    kind: FieldKind;
    required?: boolean;
    children?: FieldDefinition[];
    options?: string[];
};
export type DesignPrimitive = {
    alignment?: 'left' | 'center' | 'right' | 'start' | 'end';
    width?: 'content' | 'wide' | 'full';
    spacing?: 'small' | 'medium' | 'large' | 'extra-large' | 'compact' | 'normal' | 'spacious';
    imageTreatment?: 'background' | 'split' | 'feature';
    overlay?: 'none' | 'light' | 'dark';
    textContrast?: 'normal' | 'light' | 'dark';
    buttonStyle?: 'primary' | 'outline' | 'minimal';
    tone?: 'neutral' | 'accent';
};
export type BlockType = {
    id: ID;
    slug: string;
    name: string;
    rendererKey: string;
    status: Lifecycle;
    fields: FieldDefinition[];
    _status?: 'draft' | 'published';
};
export type BlockDesign = {
    id: ID;
    slug: string;
    name: string;
    blockType: ID;
    status: Lifecycle;
    design: DesignPrimitive;
    _status?: 'draft' | 'published';
};
export type TemplateSection = {
    id?: ID;
    key: string;
    name: string;
    blockType: ID;
    blockDesign: ID;
    required?: boolean;
    allowDesignOverride?: boolean;
};
export type Template = {
    id: ID;
    slug: string;
    name: string;
    status: Lifecycle;
    allowedCollections: string[];
    sections: TemplateSection[];
    _status?: 'draft' | 'published';
};
export type ContentValues = Record<string, Record<string, unknown>>;
export type TemplatedContent = {
    id: ID;
    template: ID;
    templateValues?: ContentValues;
    designOverrides?: Record<string, ID | null>;
};
export type ResolvedSection = {
    key: string;
    name: string;
    required: boolean;
    allowDesignOverride: boolean;
    blockType: BlockType;
    blockDesign: BlockDesign;
    values: Record<string, unknown>;
};
export type ResolvedTemplate = {
    template: Template;
    sections: Omit<ResolvedSection, 'values'>[];
};
export type ResolvedContent = {
    contentId: ID;
    template: Template;
    sections: ResolvedSection[];
};
export type DesignEvent = {
    type: 'blockDesignPublished' | 'templatePublished';
    id: ID;
    slug: string;
};
export type DesignEventHandler = (event: DesignEvent) => void | Promise<void>;
export type BlockRegistration = {
    slug: string;
    rendererKey: string;
    fields: FieldKind[];
    design: (keyof DesignPrimitive)[];
};
export type ExportEnvelope<T> = {
    schemaVersion: 1;
    kind: 'block-design' | 'template';
    item: T;
    dependencies: string[];
};
