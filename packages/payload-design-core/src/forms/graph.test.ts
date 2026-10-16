import { describe, it, expect } from 'vitest'
import { supportExample } from './graph-example'
import { graphAnswers, graphIssues, graphScope, graphShape, runGraph, type GraphEvent } from './graph'
import { validateAnswers, validateDefinition } from './engine'
import { exportForm, importForm } from './transfer'

const event = (node: string, output = 'next'): GraphEvent => ({ node, output })
const first = [event('canvas_name'), event('canvas_contact'), event('canvas_ticket')]
describe('form logic graph', () => {
  it('ships a valid editable example', () => expect(validateDefinition(supportExample())).toEqual([]))
  for (const type of ['sharepoint', 'teams', 'email', 'vortiquest']) it(`routes ${type}, converges, and excludes inactive required answers`, () => {
    const definition = supportExample(), answers = { person: { first: 'Ada', last: 'Lovelace' }, email_address: 'ada@example.com', ticket_type: type, [`${type}_details`]: 'Please help', blocked: 'yes', email_details: 'Old branch answer' }
    const events = [...first, event(`canvas_${type}`), event('canvas_review')]
    const run = runGraph(definition, answers, events), scope = graphScope(definition, run)
    expect(run.error).toBeUndefined(); expect(run.node?.kind).toBe('submit')
    expect(run.variables.priority).toBe(type === 'teams' ? 'High' : 'Normal')
    const result = validateAnswers(scope, graphAnswers(definition, scope, run.answers))
    expect(result.issues).toEqual([])
    if (type !== 'email') expect(result.answers.email_details).toBeUndefined()
    expect(runGraph(definition, answers, [...events, event('submit', 'success')]).error).toBeTruthy()
    const accepted = runGraph(definition, answers, [...events, event('submit', 'success')], true)
    expect(accepted.node?.canvas).toBe('confirmation'); expect(accepted.log.some(line => line.includes('Simulated email'))).toBe(true)
  })
  it('replays new answers after Back without retaining the abandoned path', () => {
    const definition = supportExample()
    expect(runGraph(definition, { ticket_type: 'teams' }, first).node?.canvas).toBe('teams')
    expect(runGraph(definition, { ticket_type: 'email' }, first).node?.canvas).toBe('email')
    expect(runGraph(definition, { ticket_type: 'email' }, [...first, event('canvas_teams')]).error).toBeTruthy()
  })
  it('retries a connected failure path without trusting acceptance or exempting visited fields', () => {
    const d = supportExample()
    d.graph!.nodes.push({ id: 'retry', kind: 'message', name: 'Retry', message: 'Please try again.' })
    d.graph!.edges.push({ id: 'failure', source: 'submit', output: 'failure', target: 'retry' }, { id: 'retry-submit', source: 'retry', output: 'next', target: 'submit' })
    const events = [...first, event('canvas_email'), event('canvas_review'), event('submit', 'failure'), event('retry')]
    const run = runGraph(d, { ticket_type: 'email' }, events)
    expect(run.error).toBeUndefined()
    expect(run.node?.kind).toBe('submit')
    expect(validateAnswers(graphScope(d, run), run.answers).issues.some(i => i.field === 'email_details')).toBe(true)
    expect(runGraph(d, {}, [...events, event('submit', 'success')]).error).toBeTruthy()
  })
  it('rejects forged histories and preserves unknown-field validation', () => {
    const definition = supportExample()
    for (const events of [undefined, [null], [{ node: 'canvas_review', output: 'next' }], Array(501).fill(event('canvas_name'))]) expect(runGraph(definition, {}, events as GraphEvent[]).error).toBeTruthy()
    const run = runGraph(definition, { forged: 'value' }, [])
    const scope = graphScope(definition, run)
    expect(validateAnswers(scope, graphAnswers(definition, scope, run.answers)).issues.some(i => i.path === 'forged')).toBe(true)
  })
  it('stops automatic cycles and conflicting edges', () => {
    const d = supportExample(); d.graph!.edges.push({ id: 'bad', source: 'start', output: 'next', target: 'start' })
    expect(graphIssues(d).some(i => i.message.includes('conflicting'))).toBe(true)
    expect(runGraph(d, {}, []).error).toContain('Conflicting')
    d.graph!.edges = [{ id: 'loop', source: 'start', output: 'next', target: 'start' }]
    expect(runGraph(d, {}, []).error).toContain('100')
  })
  it('detects malformed conditions and removed references without executing code', () => {
    const d = supportExample(); d.graph!.nodes.find(n => n.kind === 'if')!.condition = { field: 'blocked', operator: 'constructor' as never }
    expect(graphShape(d.graph)).toBe(false)
    expect(graphIssues(d)[0].message).toContain('malformed')
    const valid = supportExample(); valid.fields = valid.fields.filter(f => f.id !== 'teams')
    expect(graphIssues(valid).some(i => i.message.includes('existing canvas'))).toBe(true)
  })
  it('imports fresh field/node IDs and preserves connections, values, and mappings', () => {
    const definition = importForm(exportForm('Example', supportExample())).definition
    expect(validateDefinition(definition)).toEqual([])
    expect(definition.graph!.nodes.some(n => n.id === 'start')).toBe(false)
    const choice = definition.fields.find(f => f.label === 'Ticket Type')!.children![0]
    const select = definition.graph!.nodes.find(n => n.kind === 'switch')!
    expect(select.field).toBe(choice.id)
    expect(select.cases!.map(c => c.value)).toEqual(choice.options!.map(o => o.id))
  })
  it('renaming does not change identity and disabled graphs do not block legacy publication', () => {
    const definition = supportExample(); definition.fields[0].label = 'Renamed'
    expect(runGraph(definition, {}, []).node?.canvas).toBe('name')
    definition.graph!.enabled = false; definition.graph!.edges = []
    expect(validateDefinition(definition)).toEqual([])
  })
  it('uses field rules, waits at messages, and copies or clears assigned values', () => {
    const d = supportExample()
    d.fields.push({ id: 'priority_field', kind: 'hidden', label: 'Priority', defaultValue: 'Low' })
    const high = d.graph!.nodes.find(n => n.id === 'high')!
    high.variable = false; high.target = 'priority_field'; high.source = 'email_address'
    const events = [...first, event('canvas_teams')]
    let run = runGraph(d, { ticket_type: 'teams', blocked: 'yes', email_address: 'ada@example.com' }, events)
    let scoped = graphScope(d, run)
    expect(validateAnswers(scoped, graphAnswers(d, scoped, run.answers)).answers.priority_field).toBe('ada@example.com')
    high.clear = true
    run = runGraph(d, { ticket_type: 'teams', blocked: 'yes' }, events); scoped = graphScope(d, run)
    expect(validateAnswers(scoped, graphAnswers(d, scoped, run.answers)).answers.priority_field).toBeUndefined()
    d.rules.push({ id: 'rule', name: 'Always Teams', when: { all: [] }, effects: [{ kind: 'set', target: 'ticket_type', value: 'teams' }] })
    expect(runGraph(d, { ticket_type: 'email' }, first).node?.canvas).toBe('teams')
    d.graph!.nodes.push({ id: 'message', name: 'Pause', kind: 'message', message: 'Please continue' })
    d.graph!.edges.find(e => e.source === 'start')!.target = 'message'
    d.graph!.edges.push({ id: 'continue', source: 'message', output: 'next', target: 'canvas_name' })
    expect(runGraph(d, {}, []).node?.kind).toBe('message')
    expect(runGraph(d, {}, [event('message')]).node?.canvas).toBe('name')
  })
})
