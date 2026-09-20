import type { TemplateFieldKind, TemplateLayoutKind } from './types'

export type EditorElementCategory = 'text' | 'media' | 'layout' | 'data' | 'designed'
export type EditorElementKind = 'layout' | 'field' | 'block'

export type EditorElementDefinition = {
  kind: EditorElementKind
  value: string
  label: string
  description: string
  category: EditorElementCategory
  keywords: string[]
  frequentlyUsed?: boolean
  allowedParents?: Array<'root' | 'container' | 'row' | 'column' | 'stack'>
}

export type EditorLibraryItem = Pick<EditorElementDefinition, 'kind' | 'value' | 'label'>

const layout = (value: TemplateLayoutKind, label: string, description: string, frequentlyUsed = false): EditorElementDefinition => ({
  kind: 'layout', value, label, description, category: 'layout', keywords: [value, label.toLowerCase(), 'layout'], frequentlyUsed,
})

const field = (value: TemplateFieldKind, label: string, description: string, category: EditorElementCategory, frequentlyUsed = false): EditorElementDefinition => ({
  kind: 'field', value, label, description, category, keywords: [value, label.toLowerCase(), 'field'], frequentlyUsed,
})

export const coreEditorElements: EditorElementDefinition[] = [
  field('shortText', 'Heading / Short Text', 'A single line heading, label, or short value.', 'text', true),
  field('longText', 'Paragraph', 'A plain multi-line text area.', 'text', true),
  field('richText', 'Rich Text', 'Structured Lexical content with publishing controls.', 'text', true),
  field('image', 'Image', 'Select or upload one Media item.', 'media', true),
  field('images', 'Gallery', 'Select, order, and display multiple Media items.', 'media', true),
  field('videoURL', 'Video', 'A URL for an externally hosted video.', 'media'),
  field('link', 'Link', 'A URL or linked destination.', 'text'),
  layout('columns', 'Columns', 'Place blocks in a responsive column layout.', true),
  layout('container', 'Container', 'Constrain and group child blocks.'),
  layout('row', 'Row', 'Arrange child blocks in a horizontal row.'),
  layout('stack', 'Stack', 'Arrange child blocks vertically.'),
  layout('spacer', 'Spacer', 'Add controlled vertical space.'),
  layout('divider', 'Divider', 'Separate sections with a visual rule.'),
  field('date', 'Date', 'A calendar date value.', 'data'),
  field('number', 'Number', 'A numeric value.', 'data'),
  field('select', 'Select', 'Choose from a controlled set of options.', 'data'),
  field('toggle', 'Toggle', 'A true or false setting.', 'data'),
  field('relationship', 'Relationship', 'Reference another Payload document.', 'data'),
]

export const editorCategoryLabels: Record<EditorElementCategory, string> = {
  text: 'Text', media: 'Media', layout: 'Layout', data: 'Data', designed: 'Designed Blocks',
}

export function toLibraryItem(definition: EditorElementDefinition): EditorLibraryItem {
  return { kind: definition.kind, value: definition.value, label: definition.label }
}

export function searchEditorElements(elements: EditorElementDefinition[], query: string): EditorElementDefinition[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return elements
  return elements.filter((element) => [element.label, element.description, ...element.keywords].some((value) => value.toLowerCase().includes(normalized)))
}
