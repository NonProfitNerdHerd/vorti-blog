import { emptyDefinition, flattenFields, makeID, type FormDefinition } from './model'
import { validateDefinition } from './engine'
import { cloneFields } from './clone'
import { definitionShapeIssues } from './shape'

export interface FormPackage { format: 'vorti-form'; version: 1; title: string; definition: FormDefinition }
/** Portable exports deliberately omit provider configuration and private action mappings. */
export function exportForm(title: string, definition: FormDefinition): FormPackage {
  const portable = structuredClone(definition)
  const clean = (fields: typeof portable.fields, sensitive = false) => fields.forEach(field => {
    const privateField = sensitive || field.sensitive === true
    if (privateField || flattenFields(field.children || []).some(child => child.sensitive)) delete field.defaultValue
    delete field.choiceSource
    delete field.prefill
    delete field.group
    if (field.children) clean(field.children, privateField)
  })
  clean(portable.fields)
  return { format: 'vorti-form', version: 1, title, definition: { ...portable, actions: [],
    rules: definition.rules.map(rule => ({ ...rule, effects: rule.effects.filter(effect => effect.kind !== 'action') })).filter(rule => rule.effects.length),
    payment: undefined, access: { ...definition.access, origins: [], embedOrigins: [] } } }
}
export function importForm(input: unknown): FormPackage {
  if (!input || typeof input !== 'object' || !('format' in input) || input.format !== 'vorti-form' || !('version' in input) || input.version !== 1 || !('definition' in input)) throw new Error('Choose a version 1 Vorti form export.')
  const source = input as FormPackage
  if (JSON.stringify(source).length > 1000000) throw new Error('Form export exceeds 1 MB.')
  const shapeIssues = definitionShapeIssues(source.definition)
  if (shapeIssues.length) throw new Error(shapeIssues.map(issue => issue.message).join(' '))
  const definition: FormDefinition = { ...emptyDefinition(), ...exportForm('', source.definition).definition }
  const issues = validateDefinition(definition)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(' '))
  const cloned = cloneFields(definition.fields)
  definition.fields = cloned.fields
  definition.rules = definition.rules.map(rule => ({ ...rule, id: makeID('rule'), when: cloned.condition(rule.when), effects: rule.effects.filter(effect => effect.kind !== 'action').map(cloned.effect) }))
  return { format: 'vorti-form', version: 1, title: typeof source.title === 'string' ? source.title.slice(0, 200) || 'Imported form' : 'Imported form', definition }
}
/** This is the only definition projection allowed on unauthenticated endpoints. */
export function publicDefinition(definition: FormDefinition): FormDefinition {
  const projected = structuredClone(definition)
  projected.actions = []
  delete projected.workflow
  projected.rules = projected.rules.map(rule => ({ ...rule, effects: rule.effects.filter(effect => effect.kind !== 'action') }))
  projected.access.origins = []; projected.access.embedOrigins = []
  for (const field of flattenFields(projected.fields)) {
    delete field.choiceSource
    if (field.prefill?.source === 'profile') delete field.prefill
  }
  return projected
}
