import type { ReactNode } from 'react'
import type { Answers, FormField, FormValue } from './model'
import { formFields } from './registry'
import './summary.css'

export interface SubmissionSummaryProps {
  fields: FormField[]
  answers: Answers
  attachment?: (id: string, field: FormField) => ReactNode
}
const labels: Record<string, string> = { full: 'Full name', middle: 'Middle name / initial', first: 'First name', last: 'Last name', line1: 'Address', line2: 'Address line 2', city: 'City', region: 'State / region', postalCode: 'Postal code', country: 'Country', start: 'Start', end: 'End' }
function StructuredValue({ value }: { value: FormValue }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="forms-summary-empty">Not provided</span>
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return <ol>{value.map((item, index) => <li key={index}><StructuredValue value={item} /></li>)}</ol>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{labels[key] || key}</dt><dd><StructuredValue value={item} /></dd></div>)}</dl>
  return String(value)
}
export function SubmissionSummary({ fields, answers, attachment }: SubmissionSummaryProps) {
  return <div className="forms-summary">{fields.map(field => {
    const value = answers[field.id]
    const registration = formFields.get(field.kind)
    if (registration?.structural) return field.children?.length ? <section key={field.id}><h3>{field.label}</h3><SubmissionSummary fields={field.children} answers={answers} attachment={attachment} /></section> : null
    let content: ReactNode
    if (field.sensitive && value === undefined) content = <span>Sensitive answer — permission required</span>
    else if (field.kind === 'repeater' && Array.isArray(value)) content = value.length ? <ol>{value.map((row, index) => <li key={index}><h4>Item {index + 1}</h4><SubmissionSummary fields={field.children || []} answers={row && typeof row === 'object' && !Array.isArray(row) ? row : {}} attachment={attachment} /></li>)}</ol> : <span>No items</span>
    else if (field.kind === 'upload' && Array.isArray(value)) content = <ul>{value.map((id, index) => <li key={index}>{attachment && typeof id === 'string' ? attachment(id, field) : `Attachment ${index + 1}`}</li>)}</ul>
    else if (field.kind === 'likert' && value && typeof value === 'object' && !Array.isArray(value)) content = <dl>{field.rows?.map(row => <div key={row.id}><dt>{row.label}</dt><dd>{field.options?.find(option => option.id === value[row.id])?.label || 'Not provided'}</dd></div>)}</dl>
    else if (field.kind === 'signature' && value && typeof value === 'object' && !Array.isArray(value)) {
      content = value.mode === 'typed' ? <span>{String(value.name || '')} (typed signature)</span> : <svg viewBox="0 0 500 160" role="img" aria-label="Submitted drawn signature" className="forms-summary-signature">{Array.isArray(value.strokes) && value.strokes.map((stroke, i) => Array.isArray(stroke) ? <polyline key={i} points={stroke.filter(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n))).map(point => { const [x, y] = point as number[]; return `${Math.max(0, Math.min(1, x)) * 500},${Math.max(0, Math.min(1, y)) * 160}` }).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /> : null)}</svg>
    } else if (registration?.choices && value !== undefined) content = registration.format(value, field)
    else content = <StructuredValue value={value} />
    return <section className="forms-summary-answer" key={field.id}><h3>{field.label}</h3><div>{content}</div></section>
  })}</div>
}
