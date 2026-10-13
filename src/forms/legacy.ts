import { emptyDefinition, type FormDefinition, type FormField } from '@design-system/payload-design-core/forms'

/** Read-only adapter until an author explicitly saves the new definition. Existing IDs stay stable. */
export function legacyDefinition(doc: Record<string, unknown>): FormDefinition {
  const definition = emptyDefinition()
  const fields = Array.isArray(doc.fields) ? doc.fields as Record<string, unknown>[] : []
  definition.fields = fields.map((field, index): FormField => {
    const original = String(field.blockType || 'text')
    const kind = original === 'message' ? 'content' : ['country', 'state'].includes(original) ? 'text' : original
    const id = String(field.name || `legacy_${index}`).replace(/[^a-zA-Z0-9_-]/g, '_')
    return { id: /^[a-zA-Z]/.test(id) ? id : `f_${id}`, kind, label: String(field.label || field.name || 'Information'),
      required: !!field.required, width: Number(field.width) === 50 ? 6 : 12,
      defaultValue: field.defaultValue as FormField['defaultValue'],
      options: Array.isArray(field.options) ? field.options.map((o: Record<string, unknown>, i) => ({ id: `option_${index}_${i}`, label: String(o.label || o.value), value: String(o.value || '') })) : undefined }
  })
  if (typeof doc.submitButtonLabel === 'string') definition.theme.buttonLabel = doc.submitButtonLabel
  return definition
}
