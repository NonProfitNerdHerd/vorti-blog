import { strToU8, zipSync } from 'fflate'
import { formFields, type Answers, type FormField, type FormValue } from '@design-system/payload-design-core/forms'
import { visibleAnswers } from './redaction'

export interface ExportEntry { id: number; created_at: string; revision: string; workflow_status: string; answers: string; schema_snapshot: string }
export const exportMetadata = ['entryID', 'formTitle', 'revision', 'submittedAt', 'status', 'fieldLabels'] as const
export type SpreadsheetCell = string | number | boolean
export function exportFields(fields: FormField[], sensitive = false): FormField[] {
  return fields.flatMap(field => formFields.get(field.kind)?.structural ? exportFields(field.children || [], sensitive || !!field.sensitive) : [{ ...field, sensitive: sensitive || !!field.sensitive }])
}
function structured(field: FormField, value: FormValue): FormValue {
  if (field.kind === 'repeater' && Array.isArray(value)) return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    return Object.fromEntries(exportFields(field.children || []).filter(child => row[child.id] !== undefined).map(child => [child.id, structured(child, row[child.id])]))
  })
  if (formFields.get(field.kind)?.choices) return Array.isArray(value) ? value.map(id => field.options?.find(option => option.id === id)?.label || id) : field.options?.find(option => option.id === value)?.label || value
  return value
}
export function exportRow(entry: ExportEntry, columns: string[], sensitive: boolean): SpreadsheetCell[] {
  const schema = JSON.parse(entry.schema_snapshot) as { title: string; fields: FormField[] }
  const values = visibleAnswers(schema.fields, JSON.parse(entry.answers) as Answers, sensitive)
  const fields = exportFields(schema.fields)
  const metadata: Record<string, SpreadsheetCell> = { entryID: entry.id, formTitle: schema.title, revision: entry.revision || '', submittedAt: entry.created_at, status: entry.workflow_status || 'received',
    fieldLabels: JSON.stringify(Object.fromEntries(fields.filter(field => sensitive || !field.sensitive).map(field => [field.id, field.label]))) }
  return columns.map(column => {
    if (!column.startsWith('field:')) return metadata[column] ?? ''
    const id = column.slice(6), field = fields.find(field => field.id === id)
    if (!field || values[id] === undefined) return ''
    const value = structured(field, values[id])
    return value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value
  })
}
/** Text starting with a spreadsheet operator stays text even when imported as CSV. */
export function safeSpreadsheetText(value: string): string { return /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value }
export function csvDocument(rows: SpreadsheetCell[][]): Uint8Array {
  return strToU8('\uFEFF' + rows.map(row => row.map(value => `"${(typeof value === 'string' ? safeSpreadsheetText(value) : String(value)).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n')
}
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
function columnName(index: number): string { let result = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result }
/** Genuine SpreadsheetML/OPC workbook. No macros, formulas, remote links, or executable cells. */
export function xlsxDocument(rows: SpreadsheetCell[][]): Uint8Array {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${rows.map((row, index) => `<row r="${index + 1}">${row.map((value, c) => {
    const ref = `${columnName(c)}${index + 1}`
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
    const text = String(value)
    if (text.length > 32767) throw new Error('A value exceeds the XLSX cell limit. Choose CSV or exclude that field.')
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`
  }).join('')}</row>`).join('')}</sheetData></worksheet>`
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Entries" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }, { level: 6 })
}
