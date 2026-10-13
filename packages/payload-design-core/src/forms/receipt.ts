import type { Answers, FormField, FormValue } from './model'
import { formFields } from './registry'

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function valueHTML(value: FormValue | undefined): string {
  if (value === undefined || value === null || value === '') return '<span>Not provided</span>'
  if (Array.isArray(value)) return `<ol>${value.map(item => `<li>${valueHTML(item)}</li>`).join('')}</ol>`
  if (typeof value === 'object') return `<dl>${Object.entries(value).map(([key, item]) => `<dt>${escape(key)}</dt><dd>${valueHTML(item)}</dd>`).join('')}</dl>`
  return escape(typeof value === 'boolean' ? value ? 'Yes' : 'No' : value)
}
function answerHTML(fields: FormField[], answers: Answers): string {
  return fields.map(field => {
    const value = answers[field.id]
    let content: string
    if (field.sensitive && value === undefined) content = 'Sensitive answer — permission required'
    else if (field.kind === 'repeater' && Array.isArray(value)) content = `<ol>${value.map(row => `<li>${answerHTML(field.children || [], row && typeof row === 'object' && !Array.isArray(row) ? row : {})}</li>`).join('')}</ol>`
    else if (formFields.get(field.kind)?.structural) return field.children?.length ? `<section><h2>${escape(field.label)}</h2>${answerHTML(field.children, answers)}</section>` : ''
    else if (field.kind === 'upload') content = Array.isArray(value) ? `${value.length} attachment(s). Downloads require entry access.` : 'No attachments'
    else if (field.kind === 'signature' && value && typeof value === 'object' && !Array.isArray(value)) {
      content = value.mode === 'typed' ? `${escape(value.name)} (typed signature)` : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 160" width="500" style="max-width:100%;height:auto" role="img" aria-label="Submitted drawn signature">${Array.isArray(value.strokes) ? value.strokes.map(stroke => Array.isArray(stroke) ? `<polyline fill="none" stroke="currentColor" stroke-width="2" points="${stroke.filter(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n))).map(point => { const [x, y] = point as number[]; return `${Math.max(0, Math.min(1, x)) * 500},${Math.max(0, Math.min(1, y)) * 160}` }).join(' ')}"/>` : '').join('') : ''}</svg>`
    }
    else if (field.kind === 'likert' && value && typeof value === 'object' && !Array.isArray(value)) content = `<dl>${(field.rows || []).map(row => `<dt>${escape(row.label)}</dt><dd>${escape(field.options?.find(option => option.id === value[row.id])?.label || 'Not provided')}</dd>`).join('')}</dl>`
    else if (formFields.get(field.kind)?.choices && value !== undefined) content = escape(formFields.get(field.kind)!.format(value, field))
    else content = valueHTML(value)
    return `<section class="answer"><h2>${escape(field.label)}</h2><div>${content}</div></section>`
  }).join('')
}
/** Shared printable receipt: escaped content only, with no JavaScript or external assets. */
export function receiptDocument(input: { title: string; fields: FormField[]; answers: Answers; entryID: string; revision: string; submittedAt: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(input.title)} — Receipt</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:white;max-width:900px;margin:32px auto;padding:0 24px}h1{font-size:1.8rem}h2{font-size:1rem;margin:0 0 8px}.answer{padding:16px 0;border-bottom:1px solid #ddd;break-inside:avoid;overflow-wrap:anywhere}.answer>div{white-space:pre-wrap}dt{font-weight:600}dd{margin:0 0 8px}.meta{color:#444}.print-help{padding:12px;background:#f4f4f4}@media print{body{margin:0;max-width:none;padding:0}.print-help{display:none}a{color:inherit}}</style></head><body><main><h1>${escape(input.title)}</h1><p class="print-help">Use your browser’s Print command to print this receipt or save it as a PDF.</p><dl class="meta"><dt>Entry</dt><dd>${escape(input.entryID)}</dd><dt>Submitted</dt><dd>${escape(input.submittedAt)}</dd><dt>Form revision</dt><dd>${escape(input.revision)}</dd></dl>${answerHTML(input.fields, input.answers)}</main></body></html>`
}
