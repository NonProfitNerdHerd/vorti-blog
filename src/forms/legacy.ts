import { emptyDefinition, formFields, type FormField, type FormDefinition, type FormValue } from '@design-system/payload-design-core/forms'
export type LegacyIssue = { area: 'fields' | 'email'; message: string }
export type ReviewedDefinition = FormDefinition & { legacyReview?: string[]; legacyEmailsImported?: boolean }
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
function plainText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const node = value as Record<string, unknown>
  if (node.root) return plainText(node.root)
  if (typeof node.text === 'string') return node.text
  return records(node.children).map(plainText).join(node.type === 'root' ? '\n' : '')
}
/** Draft projection only. Original plugin fields and emails remain stored untouched. */
export function prepareLegacyForm(doc: Record<string, unknown>): { definition: ReviewedDefinition; issues: LegacyIssue[] } {
  const definition: ReviewedDefinition = emptyDefinition(), issues: LegacyIssue[] = []
  const warn = (area: LegacyIssue['area'], message: string) => issues.push({ area, message })
  const used = new Set<string>()
  definition.fields = records(doc.fields).map((field, index): FormField => {
    const original = String(field.blockType || 'text'), label = String(field.label || field.name || 'Information')
    let kind = original === 'message' ? 'content' : original
    if (!formFields.get(kind)) { kind = 'text'; warn('fields', `${label}: ${original} has been prepared as text; recreate its special behavior before publishing.`) }
    const originalID = String(field.name || `legacy_${index}`)
    let id = originalID.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (!/^[a-zA-Z]/.test(id)) id = `f_${id}`
    if (used.has(id)) id = `${id}_${index}`
    used.add(id)
    if (id !== originalID) warn('fields', `${label}: field ID ${originalID} needs to become ${id}; review references.`)
    const widths: Record<number, FormField['width']> = { 25: 3, 33: 4, 50: 6, 66: 8, 75: 9, 100: 12 }
    const width = widths[Number(field.width || 100)] || 12
    if (field.width && !widths[Number(field.width)]) warn('fields', `${label}: width ${field.width}% needs review; the prepared field uses full width.`)
    const options = records(field.options).map((option, i) => ({ id: `option_${index}_${i}`, label: String(option.label || option.value), value: String(option.value || '') }))
    const result: FormField = { id, kind, label, required: !!field.required, width }
    if (options.length) result.options = options
    if (field.defaultValue !== undefined) {
      result.defaultValue = options.length ? options.find(option => option.value === String(field.defaultValue))?.id : field.defaultValue as FormValue
      if (result.defaultValue === undefined) warn('fields', `${label}: the saved default does not match an option.`)
    }
    for (const key of ['help', 'placeholder', 'errorMessage', 'min', 'max', 'minLength', 'maxLength'] as const) if (field[key] !== undefined) Object.assign(result, { [key]: field[key] })
    if (kind === 'content') {
      result.help = plainText(field.message)
      if (field.message && typeof field.message !== 'string') warn('fields', `${label}: rich text was prepared as plain text; review formatting and links.`)
    }
    const supported = new Set(['id', 'blockName', 'blockType', 'name', 'label', 'required', 'width', 'defaultValue', 'options', 'help', 'placeholder', 'errorMessage', 'min', 'max', 'minLength', 'maxLength', 'message'])
    for (const [key, value] of Object.entries(field)) if (!supported.has(key) && value != null) warn('fields', `${label}: legacy setting ${key} is retained in the original record but is not applied by the canvas.`)
    return result
  })
  if (typeof doc.submitButtonLabel === 'string') definition.theme.buttonLabel = doc.submitButtonLabel
  if (doc.confirmationMessage) {
    definition.confirmation = plainText(doc.confirmationMessage) || definition.confirmation
    if (typeof doc.confirmationMessage !== 'string') warn('fields', 'Confirmation message: review the plain-text conversion of formatting and links in Actions.')
  }
  if (doc.confirmationType === 'redirect') {
    const redirect = doc.redirect as { url?: string } | undefined
    if (redirect?.url?.startsWith('/') && !redirect.url.startsWith('//')) definition.redirect = redirect.url
    else warn('fields', 'Confirmation redirect: select a supported local path in Actions; the original redirect is retained.')
  }
  const merge = (value: string, label: string) => {
    const converted = value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => key === '*' ? '{{summary}}' : `{{${key}}}`)
    for (const match of converted.matchAll(/\{\{([^}]+)\}\}/g)) if (match[1] !== 'summary' && !definition.fields.some(field => field.id === match[1])) warn('email', `${label}: placeholder ${match[0]} needs a matching field.`)
    return converted
  }
  definition.actions = records(doc.emails).map((email, index) => {
    const label = `Legacy notification ${index + 1}`
    for (const key of ['emailFrom', 'replyTo', 'cc', 'bcc']) if (email[key]) warn('email', `${label}: ${key} (${String(email[key])}) is retained for reference but not applied. Review the notification before publishing.`)
    if (email.message && typeof email.message !== 'string') warn('email', `${label}: rich-text message was prepared as plain text; review formatting and links.`)
    return { id: `legacy_email_${index}`, kind: 'email', name: label, config: { to: merge(String(email.emailTo || ''), label), subject: merge(String(email.subject || ''), label), body: merge(plainText(email.message) || '{{summary}}', label), integration: '' } }
  })
  return { definition, issues }
}
export const legacyDefinition = (doc: Record<string, unknown>) => prepareLegacyForm(doc).definition
export function legacyReviewRequired(doc: Record<string, unknown>, definition: ReviewedDefinition): boolean {
  return prepareLegacyForm(doc).issues.some(issue => !Array.isArray(definition.legacyReview) || !definition.legacyReview.includes(issue.message))
}

/** Also surface unconverted emails on forms whose fields already use the canvas. */
export function prepareStoredForm(doc: Record<string, unknown>): { definition: ReviewedDefinition; issues: LegacyIssue[] } {
  const original = doc.definition as ReviewedDefinition | undefined
  if (!original) return prepareLegacyForm(doc)
  if (original.legacyEmailsImported || !records(doc.emails).length) return { definition: original, issues: [] }
  const legacy = prepareLegacyForm(doc)
  return { definition: { ...original, legacyEmailsImported: true, actions: [...original.actions, ...legacy.definition.actions.filter(action => !original.actions.some(existing => existing.id === action.id))] }, issues: legacy.issues.filter(issue => issue.area === 'email') }
}
