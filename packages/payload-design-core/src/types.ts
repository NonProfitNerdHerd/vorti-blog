export const slugs = {
  blockTypes: 'design-block-types',
  blockDesigns: 'design-block-designs',
  templates: 'design-templates',
} as const

export type ID = string | number
export type Lifecycle = 'draft' | 'published' | 'archived'
export type FieldKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'media' | 'url' | 'date' | 'group'
export type FieldDefinition = { key: string; label: string; kind: FieldKind; required?: boolean; children?: FieldDefinition[]; options?: string[] }
export type DesignPrimitive = {
  alignment?: 'left' | 'center' | 'right' | 'start' | 'end'
  width?: 'content' | 'wide' | 'full'
  spacing?: 'small' | 'medium' | 'large' | 'extra-large' | 'compact' | 'normal' | 'spacious'
  imageTreatment?: 'background' | 'split' | 'feature'
  overlay?: 'none' | 'light' | 'dark'
  textContrast?: 'normal' | 'light' | 'dark'
  buttonStyle?: 'primary' | 'outline' | 'minimal'
  tone?: 'neutral' | 'accent'
}
export type BlockType = { id: ID; slug: string; name: string; rendererKey: string; status: Lifecycle; fields: FieldDefinition[]; _status?: 'draft' | 'published' }
export type BlockDesign = { id: ID; slug: string; name: string; blockType: ID; status: Lifecycle; design: DesignPrimitive; _status?: 'draft' | 'published' }
export type TemplateSection = { id?: ID; key: string; name: string; blockType: ID; blockDesign: ID; required?: boolean; allowDesignOverride?: boolean }
export type TemplateFieldKind = 'shortText' | 'longText' | 'richText' | 'image' | 'images' | 'videoURL' | 'link' | 'date' | 'number' | 'select' | 'toggle' | 'relationship'
export type TemplateField = { id: string; type: 'field'; fieldType: TemplateFieldKind; label: string; required?: boolean; helpText?: string; placeholder?: string; min?: number; max?: number; options?: string[]; relationTo?: string }
export type TemplateLayoutKind = 'container' | 'row' | 'columns' | 'stack' | 'spacer' | 'divider'
export type TemplateColumn = { id: string; width: number; children: TemplateNode[] }
export type TemplateLayoutNode = { id: string; type: 'layout'; layout: TemplateLayoutKind; children?: TemplateNode[]; columns?: TemplateColumn[]; spacing?: 'small' | 'medium' | 'large' }
export type TemplateBlockNode = { id: string; type: 'block'; name: string; blockType: ID; blockDesign: ID; allowDesignOverride?: boolean; fields: TemplateField[]; slotMappings: Record<string, string> }
export type TemplateNode = TemplateField | TemplateLayoutNode | TemplateBlockNode
export type Template = { id: ID; slug: string; name: string; status: Lifecycle; allowedCollections: string[]; sections: TemplateSection[]; layout?: TemplateNode[]; _status?: 'draft' | 'published' }
export type ContentValues = Record<string, unknown>
export type TemplatedContent = { id: ID; template: ID; templateValues?: ContentValues; designOverrides?: Record<string, ID | null> }
export type ResolvedSection = { key: string; name: string; required: boolean; allowDesignOverride: boolean; blockType: BlockType; blockDesign: BlockDesign; values: Record<string, unknown> }
export type ResolvedTemplate = { template: Template; sections: Omit<ResolvedSection, 'values'>[] }
export type ResolvedBlockNode = TemplateBlockNode & { blockTypeDoc: BlockType; blockDesignDoc: BlockDesign; values: Record<string, unknown> }
export type ResolvedContent = { contentId: ID; template: Template; sections: ResolvedSection[]; layout: TemplateNode[]; blocks: ResolvedBlockNode[] }
export type DesignEvent = { type: 'blockDesignPublished' | 'templatePublished'; id: ID; slug: string }
export type DesignEventHandler = (event: DesignEvent) => void | Promise<void>
export type BlockRegistration = { slug: string; rendererKey: string; fields: FieldKind[]; design: (keyof DesignPrimitive)[] }
export type ExportEnvelope<T> = { schemaVersion: 1; kind: 'block-design' | 'template'; item: T; dependencies: string[] }
