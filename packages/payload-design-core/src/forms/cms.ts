import { flattenFields, type Answers, type FormAction, type FormDefinition, type FormField } from './model'

export interface CMSMapping { key: string; label: string; kinds: string[]; required?: boolean }
export const cmsMappings: Record<string, CMSMapping[]> = {
  contact: [{ key: 'emailField', label: 'Contact email', kinds: ['email'], required: true }, { key: 'nameField', label: 'Contact name', kinds: ['text', 'name'] }],
  support: [{ key: 'titleField', label: 'Request title', kinds: ['text', 'textarea'], required: true }, { key: 'bodyField', label: 'Request details', kinds: ['text', 'textarea'], required: true }, { key: 'emailField', label: 'Reply email', kinds: ['email'] }],
  content: [{ key: 'titleField', label: 'Post title', kinds: ['text', 'textarea'], required: true }, { key: 'bodyField', label: 'Post content', kinds: ['text', 'textarea'], required: true }],
}
export function cmsMappingFields(fields: FormField[]): FormField[] {
  return fields.flatMap(field => field.kind === 'repeater' ? [] : [field, ...cmsMappingFields(field.children || [])])
}
export function cmsActionIssues(action: FormAction, definition: Pick<FormDefinition, 'fields'>): string[] {
  const mappings = cmsMappings[action.kind]
  if (!mappings) return []
  const fields = cmsMappingFields(definition.fields), all = flattenFields(definition.fields), issues: string[] = []
  for (const mapping of mappings) {
    const id = action.config[mapping.key]
    if (!id && !mapping.required) continue
    const field = fields.find(field => field.id === id)
    if (!field || !mapping.kinds.includes(field.kind)) issues.push(`${mapping.label}: choose ${mapping.kinds.join(' or ')} outside a repeatable group.`)
    // A private answer must not be copied into a destination without the same sensitivity controls.
    if (field?.sensitive || all.some(parent => parent.sensitive && flattenFields(parent.children || []).some(child => child.id === id))) issues.push(`${mapping.label}: sensitive answers cannot be mapped to CMS records.`)
  }
  return issues
}
export function mappedCMSText(answers: Answers, action: FormAction, key: string, required = false): string {
  const field = action.config[key], value = typeof field === 'string' ? answers[field] : undefined
  const text = value == null ? '' : typeof value === 'string' ? value : key === 'nameField' && typeof value === 'object' && !Array.isArray(value)
    ? [value.first, value.last].filter(part => typeof part === 'string').join(' ') : undefined
  if (text === undefined || (required && !text.trim())) throw new Error(`The answer mapped to ${key} is missing or invalid. Review the form's action conditions.`)
  return text.trim()
}
