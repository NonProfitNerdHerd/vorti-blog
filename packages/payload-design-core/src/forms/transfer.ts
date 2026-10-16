import { emptyDefinition, flattenFields, makeID, type FormDefinition } from './model'
import { validateDefinition } from './engine'
import { cloneFields } from './clone'
import { definitionShapeIssues } from './shape'

export interface FormPackage { format: 'vorti-form'; version: 1; title: string; definition: FormDefinition }
/** Portable exports deliberately omit provider configuration and private action mappings. */
export function exportForm(title: string, definition: FormDefinition): FormPackage {
  const portable = structuredClone(definition)
  delete (portable as FormDefinition & { legacyReview?: unknown }).legacyReview
  delete (portable as FormDefinition & { legacyEmailsImported?: unknown }).legacyEmailsImported
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
  if (definition.graph) {
    const graph = definition.graph, nodes = new Map(graph.nodes.map(n => [n.id, makeID('logic')]))
    graph.nodes = graph.nodes.map(n => ({ ...n, id: nodes.get(n.id)!, canvas: n.canvas ? cloned.ids.get(n.canvas) || n.canvas : undefined, field: n.field ? cloned.ids.get(n.field) || n.field : undefined, target: n.target && !n.variable ? cloned.ids.get(n.target) || n.target : n.target, source: n.source ? cloned.ids.get(n.source) || n.source : undefined, condition: n.condition ? cloned.condition(n.condition) : undefined, cases: n.cases?.map(c => ({ ...c, value: n.field ? cloned.remapValue(n.field, c.value) : c.value })), value: n.target && !n.variable && n.value !== undefined ? cloned.remapValue(n.target, n.value) : n.value, config: n.config ? Object.fromEntries(Object.entries(n.config).map(([key, text]) => [key, text.replace(/\{\{([\w-]+)\}\}/g, (_, id: string) => `{{${cloned.ids.get(id) || id}}}`)])) : undefined }))
    graph.edges = graph.edges.map(e => ({ ...e, id: makeID('edge'), source: nodes.get(e.source)!, target: nodes.get(e.target)! }))
    graph.positions = Object.fromEntries(Object.entries(graph.positions).filter(([id]) => nodes.has(id)).map(([id, position]) => [nodes.get(id)!, position]))
  }
  definition.rules = definition.rules.map(rule => ({ ...rule, id: makeID('rule'), when: cloned.condition(rule.when), effects: rule.effects.filter(effect => effect.kind !== 'action').map(cloned.effect) }))
  return { format: 'vorti-form', version: 1, title: typeof source.title === 'string' ? source.title.slice(0, 200) || 'Imported form' : 'Imported form', definition }
}
/** This is the only definition projection allowed on unauthenticated endpoints. */
export function publicDefinition(definition: FormDefinition): FormDefinition {
  const projected = structuredClone(definition)
  delete (projected as FormDefinition & { legacyReview?: unknown }).legacyReview
  delete (projected as FormDefinition & { legacyEmailsImported?: unknown }).legacyEmailsImported
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
