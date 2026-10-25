/** Plain-text templates deliberately have no executable expressions or raw HTML. */
export const correspondenceKinds = [
  'gift-receipt',
  'thank-you',
  'annual-statement',
  'membership-renewal',
  'general',
] as const
export type CorrespondenceKind = (typeof correspondenceKinds)[number]
export const correspondenceFields = [
  'recipient.name',
  'recipient.address',
  'issuer.name',
  'issuer.address',
  'document.date',
  'document.number',
  'gift.date',
  'gift.description',
  'giving.summary',
  'membership.type',
  'membership.endsOn',
] as const
export type CorrespondenceField = (typeof correspondenceFields)[number]
export interface CorrespondenceTemplate {
  name: string
  kind: CorrespondenceKind
  subject: string
  body: string
  archived: boolean
}
const fields = new Set<string>(correspondenceFields)
export function templateFields(text: string): CorrespondenceField[] {
  const found = new Set<CorrespondenceField>()
  const remainder = text.replace(/\{\{\s*([a-zA-Z][a-zA-Z.]*)\s*\}\}/g, (_, field: string) => {
    if (!fields.has(field)) throw new Error('Choose a supported correspondence merge field.')
    found.add(field as CorrespondenceField)
    return ''
  })
  if (/[{}]/.test(remainder)) throw new Error('Use complete {{field.name}} merge fields.')
  return [...found]
}
export function correspondenceTemplate(input: Record<string, unknown>): CorrespondenceTemplate {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180)
    throw new Error('Enter a template name within 180 characters.')
  if (!(correspondenceKinds as readonly unknown[]).includes(input.kind))
    throw new Error('Choose a correspondence template type.')
  if (
    typeof input.subject !== 'string' ||
    !input.subject.trim() ||
    input.subject.length > 240 ||
    /[\r\n]/.test(input.subject)
  )
    throw new Error('Enter a single-line subject within 240 characters.')
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 16000)
    throw new Error('Enter correspondence text within 16000 characters.')
  templateFields(input.subject)
  templateFields(input.body)
  return {
    name: input.name.trim(),
    kind: input.kind as CorrespondenceKind,
    subject: input.subject.trim(),
    body: input.body.trim(),
    archived: input.archived === true,
  }
}
export function mergeCorrespondence(
  text: string,
  values: Partial<Record<CorrespondenceField, string>>,
): string {
  for (const field of templateFields(text)) {
    if (typeof values[field] !== 'string')
      throw new Error('Enter all required correspondence merge values.')
  }
  // A replacement value is never interpreted as another template or as markup.
  return text.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z.]*)\s*\}\}/g,
    (_, field: CorrespondenceField) => values[field]!,
  )
}
export function escapeDocumentText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}
export function printableCorrespondence(document: {
  subject: string
  body: string
  issuer: string
  number: string
  issuedOn: string
}): string {
  const escape = escapeDocumentText
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(document.subject) +
    '</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#18212b;max-width:48rem;margin:2rem auto;padding:0 1.5rem}article{white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:2rem;border-top:1px solid #aaa;padding-top:1rem;font-size:12px}@media print{body{margin:0;max-width:none}h1{font-size:20pt}footer{break-inside:avoid}}</style></head><body><main><h1>' +
    escape(document.subject) +
    '</h1><article>' +
    escape(document.body) +
    '</article><footer>' +
    escape(document.issuer) +
    ' · ' +
    escape(document.number) +
    ' · ' +
    escape(document.issuedOn) +
    '</footer></main></body></html>'
  )
}
