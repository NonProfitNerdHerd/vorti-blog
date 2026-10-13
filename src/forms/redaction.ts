import type { Answers, FormField, FormValue } from '@design-system/payload-design-core/forms'

/** Entry readers need historical labels, not default answers, profile mappings or expressions. */
export function entrySchema(fields: FormField[], sensitive: boolean): FormField[] {
  return fields.map(field => ({
    id: field.id, kind: field.kind, label: field.label,
    ...(field.sensitive ? { sensitive: true } : {}),
    ...(!field.sensitive || sensitive ? {
      ...(field.options ? { options: field.options.map(option => ({ id: option.id, value: option.value, label: option.label })) } : {}),
      ...(field.rows ? { rows: field.rows.map(row => ({ id: row.id, value: row.value, label: row.label })) } : {}),
      ...(field.children ? { children: entrySchema(field.children, sensitive) } : {}),
    } : {}),
  }))
}

/** Historical schemas, not the current form, determine which saved values may be viewed. */
export function visibleAnswers(fields: FormField[], answers: Answers, sensitive: boolean): Answers {
  const result: Answers = {}
  for (const field of fields) {
    if (field.sensitive && !sensitive) continue
    const value = answers[field.id]
    if (field.kind === 'repeater') {
      if (Array.isArray(value)) result[field.id] = value.map(row => row && typeof row === 'object' && !Array.isArray(row) ? visibleAnswers(field.children || [], row, sensitive) : null)
    } else {
      if (value !== undefined) result[field.id] = structuredClone(value) as FormValue
      if (field.children) Object.assign(result, visibleAnswers(field.children, answers, sensitive))
    }
  }
  return result
}
