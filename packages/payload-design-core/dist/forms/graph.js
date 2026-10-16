import { matches, conditionReferences, conditionOperators } from './conditions.js';
import { evaluateForm } from './engine.js';
import { flattenFields } from './model.js';
export const graphKinds = ['start', 'canvas', 'if', 'switch', 'set', 'message', 'submit', 'email', 'cms', 'http', 'end'];
export const graphNames = { start: 'Start', canvas: 'Canvas', if: 'If / Else', switch: 'Switch', set: 'Set Value', message: 'Show Message', submit: 'Submit', email: 'Send Email · Simulated', cms: 'Create / Update CMS Record · Simulated', http: 'HTTP Request · Simulated', end: 'End' };
export function canvasButtons(definition, id) {
    return definition.fields.find(f => f.id === id)?.buttons ?? [{ id: 'next', label: 'Next', event: 'next' }, { id: 'back', label: 'Back', event: 'back' }];
}
export function graphOutputs(node, definition) {
    if (node.kind === 'end')
        return [];
    if (node.kind === 'canvas')
        return canvasButtons(definition, node.canvas).filter(b => b.event !== 'back');
    if (node.kind === 'if')
        return [{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }];
    if (node.kind === 'switch')
        return [...(node.cases || []).map(c => ({ id: c.id, label: c.label })), { id: 'default', label: 'Default' }];
    if (node.kind === 'submit')
        return [{ id: 'success', label: 'Accepted' }, { id: 'failure', label: 'Failure' }];
    return [{ id: 'next', label: node.kind === 'message' ? 'Continue' : 'Next' }];
}
const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function validCondition(value, depth = 0) {
    if (!record(value) || depth > 10)
        return false;
    if ('all' in value || 'any' in value) {
        const items = value.all ?? value.any;
        return Array.isArray(items) && items.length <= 50 && items.every(v => validCondition(v, depth + 1));
    }
    return typeof value.field === 'string' && typeof value.operator === 'string' && Object.hasOwn(conditionOperators, value.operator) && (value.compareField === undefined || typeof value.compareField === 'string');
}
export function graphShape(value) {
    if (!record(value) || value.version !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.nodes) || value.nodes.length > 200 || !Array.isArray(value.edges) || value.edges.length > 600 || !record(value.positions))
        return false;
    return value.nodes.every(n => record(n) && typeof n.id === 'string' && typeof n.name === 'string' && graphKinds.includes(n.kind) && ['canvas', 'field', 'target', 'source', 'message'].every(k => n[k] === undefined || typeof n[k] === 'string') && (n.condition === undefined || validCondition(n.condition)) && ['variable', 'clear'].every(k => n[k] === undefined || typeof n[k] === 'boolean') && (n.cases === undefined || Array.isArray(n.cases) && n.cases.length <= 100 && n.cases.every(c => record(c) && typeof c.id === 'string' && typeof c.label === 'string')) && (n.config === undefined || record(n.config) && Object.values(n.config).every(v => typeof v === 'string'))) && value.edges.every(e => record(e) && ['id', 'source', 'output', 'target'].every(k => typeof e[k] === 'string')) && Object.values(value.positions).every(p => record(p) && Number.isFinite(p.x) && Number.isFinite(p.y));
}
export function graphIssues(definition) {
    const graph = definition.graph;
    if (!graph)
        return [];
    if (!graphShape(graph))
        return [{ message: 'The logic graph is malformed.' }];
    const issues = [], fields = flattenFields(definition.fields), ids = new Set();
    const add = (message, node) => issues.push({ message, node });
    if (graph.nodes.filter(n => n.kind === 'start').length !== 1)
        add('Add exactly one Start block.');
    if (definition.fields.some(f => !['step', 'hidden', 'calculated'].includes(f.kind)))
        add('Organize visible top-level parts into canvases in Build before enabling navigation.');
    if (definition.rules.some(r => r.effects.some(e => e.kind === 'route')))
        add('Remove legacy Go to canvas rules before enabling graph navigation.');
    for (const node of graph.nodes) {
        if (!/^[\w-]+$/.test(node.id) || ids.has(node.id))
            add('Use unique block IDs.', node.id);
        ids.add(node.id);
        if (node.kind === 'canvas' && !definition.fields.some(f => f.id === node.canvas && f.kind === 'step'))
            add('Choose an existing canvas.', node.id);
        if (node.kind === 'canvas') {
            const buttons = canvasButtons(definition, node.canvas);
            if (new Set(buttons.map(b => b.id)).size !== buttons.length || buttons.some(b => !b.label.trim() || !/^[\w-]+$/.test(b.id)))
                add('Give canvas buttons unique IDs and nonempty labels.', node.id);
        }
        if (node.kind === 'if') {
            try {
                if (!node.condition || !conditionReferences(node.condition).length || conditionReferences(node.condition).some(id => !fields.some(f => f.id === id)))
                    add('Choose valid condition fields.', node.id);
                else
                    matches(node.condition, {});
            }
            catch {
                add('Configure a valid condition.', node.id);
            }
        }
        if (node.kind === 'switch' && (!fields.some(f => f.id === node.field) || !node.cases?.length))
            add('Choose a field and add cases.', node.id);
        if (node.cases && (new Set(node.cases.map(c => c.id)).size !== node.cases.length || node.cases.some(c => c.id === 'default' || !c.label.trim())))
            add('Use unique case IDs and branch names.', node.id);
        if (node.kind === 'set' && (node.variable ? !/^[a-zA-Z][\w-]{0,63}$/.test(node.target || '') || ['constructor', 'prototype', '__proto__'].includes(node.target || '') : !fields.some(f => f.id === node.target)))
            add('Choose a valid answer or variable.', node.id);
        if (node.source && !fields.some(f => f.id === node.source))
            add('The copied answer no longer exists.', node.id);
        if (node.kind === 'set' && !node.clear && node.source === '')
            add('Choose the answer to copy.', node.id);
        if (node.kind === 'email' && (!node.config?.recipient?.trim() || !node.config?.subject?.trim()))
            add('Enter a recipient and subject for the simulated email.', node.id);
        if (node.kind === 'cms' && (!['create', 'update'].includes(node.config?.operation || '') || !node.config?.collection?.trim()))
            add('Choose create or update and a CMS target.', node.id);
        if (node.kind === 'http') {
            try {
                const url = new URL(node.config?.url || '');
                if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(node.config?.method || ''))
                    throw new Error();
            }
            catch {
                add('Enter an HTTP method and URL without credentials.', node.id);
            }
        }
        if (['message', 'end'].includes(node.kind) && !node.message?.trim())
            add('Enter a message.', node.id);
        for (const output of graphOutputs(node, definition)) {
            const edges = graph.edges.filter(e => e.source === node.id && e.output === output.id);
            if (edges.length > 1)
                add(`Resolve conflicting ${output.label} connections.`, node.id);
            if (!edges.length && !(node.kind === 'submit' && output.id === 'failure'))
                add(`Connect ${output.label}.`, node.id);
        }
    }
    if (new Set(graph.edges.map(e => e.id)).size !== graph.edges.length)
        add('Use unique connection IDs.');
    for (const edge of graph.edges)
        if (!ids.has(edge.source) || !ids.has(edge.target) || !graphOutputs(graph.nodes.find(n => n.id === edge.source), definition).some(o => o.id === edge.output))
            add('Remove or reconnect a broken connection.', edge.source);
    return issues;
}
export function graphPayload(node, answers, variables) {
    return Object.fromEntries(Object.entries(node.config || {}).map(([key, value]) => [key, value.replace(/\{\{(variable:)?([\w-]+)\}\}/g, (_, variable, id) => { const v = (variable ? variables : answers)[id]; return typeof v === 'string' ? v : JSON.stringify(v ?? ''); })]));
}
/** Pure bounded interpreter. Clients may retry a failure path, but cannot assert acceptance.
 * A retry still validates every visited canvas; a failure event grants no exemptions. */
export function runGraph(definition, raw, events, outcomes = false) {
    const graph = definition.graph, result = { answers: { ...raw }, assignments: {}, variables: {}, canvases: [], edges: [], log: [] };
    if (!graphShape(graph) || !Array.isArray(events) || events.length > 500 || events.some(e => !record(e) || typeof e.node !== 'string' || typeof e.output !== 'string'))
        return { ...result, error: 'Invalid or excessive navigation history.' };
    let node = graph.nodes.find(n => n.kind === 'start'), cursor = 0, transitions = 0, total = 0;
    const follow = (output) => {
        const edges = graph.edges.filter(e => e.source === node?.id && e.output === output);
        if (edges.length !== 1)
            throw new Error(edges.length ? 'Conflicting outgoing connections.' : `Connect ${output} on ${node?.name}.`);
        result.edges.push(edges[0].id);
        node = graph.nodes.find(n => n.id === edges[0].target);
        if (!node)
            throw new Error('A connected block was removed.');
    };
    try {
        if (!node)
            throw new Error('Add a Start block.');
        while (node) {
            if (++total > 5000)
                throw new Error('This flow exceeds the session transition limit. Restart the form.');
            if (++transitions > 100)
                throw new Error('Stopped after 100 automatic transitions. Check for a loop.');
            result.node = node;
            if (node.kind === 'canvas') {
                if (!result.canvases.includes(node.canvas))
                    result.canvases.push(node.canvas);
                result.log.push(`Navigated to ${definition.fields.find(f => f.id === node.canvas)?.label || node.name}.`);
            }
            if (['canvas', 'message', 'end', 'submit'].includes(node.kind)) {
                const event = events[cursor];
                if (!event)
                    break;
                if (event.node !== node.id || node.kind === 'end' || node.kind === 'submit' && !outcomes && event.output !== 'failure' || !graphOutputs(node, definition).some(o => o.id === event.output))
                    throw new Error('Navigation does not match the configured flow. Return to the previous canvas and try again.');
                result.log.push(`${graphOutputs(node, definition).find(o => o.id === event.output)?.label} on ${node.name}.`);
                cursor++;
                transitions = 0;
                follow(event.output);
                continue;
            }
            let output = 'next';
            const referenced = node.kind === 'if' && node.condition ? conditionReferences(node.condition) : node.kind === 'switch' ? [node.field] : node.source ? [node.source] : [];
            if (referenced.some(id => definition.fields.some(canvas => canvas.kind === 'step' && !result.canvases.includes(canvas.id) && flattenFields(canvas.children || []).some(f => f.id === id))))
                throw new Error('This block reads an answer from a canvas that has not been visited.');
            const evaluated = evaluateForm(graphScope(definition, result), result.answers).answers;
            if (node.kind === 'if') {
                output = matches(node.condition, evaluated) ? 'true' : 'false';
                result.log.push(`${node.name} evaluated to ${output}.`);
            }
            if (node.kind === 'switch') {
                const match = node.cases?.find(c => JSON.stringify(c.value) === JSON.stringify(evaluated[node.field]));
                output = match?.id || 'default';
                result.log.push(`${node.name} selected ${match?.label || 'Default'}.`);
            }
            if (node.kind === 'set') {
                const target = node.target;
                if (['__proto__', 'prototype', 'constructor'].includes(target))
                    throw new Error('Invalid value target.');
                const values = node.variable ? result.variables : result.answers;
                if (node.clear)
                    values[target] = null;
                else
                    values[target] = node.source ? evaluated[node.source] ?? null : node.value ?? null;
                if (!node.variable)
                    result.assignments[target] = values[target];
                result.log.push(`Set ${target} to ${JSON.stringify(values[target] ?? null)}.`);
            }
            if (['email', 'cms', 'http'].includes(node.kind))
                result.log.push(`Simulated ${node.kind}: ${JSON.stringify(graphPayload(node, evaluated, result.variables))}. No external action was performed.`);
            follow(output);
        }
        if (cursor !== events.length)
            throw new Error('Unexpected navigation events.');
    }
    catch (e) {
        result.error = e.message;
    }
    return result;
}
export function graphScope(definition, run) {
    return { ...definition, graph: undefined, mode: 'standard', fields: definition.fields.filter(f => f.kind !== 'step' || run.canvases.includes(f.id)), rules: [...definition.rules.filter(r => !r.effects.some(e => e.kind === 'route')), { id: 'graph_assignments', name: 'Flow values', when: { all: [] }, effects: Object.entries(run.assignments).map(([target, value]) => value === null ? { kind: 'clear', target } : { kind: 'set', target, value }) }] };
}
/** Discard only known inactive answers. Unknown submitted keys still reach normal validation. */
export function graphAnswers(definition, scoped, answers) {
    const known = new Set(flattenFields(definition.fields).map(f => f.id)), active = new Set(flattenFields(scoped.fields).map(f => f.id));
    return Object.fromEntries(Object.entries(answers).filter(([id]) => !known.has(id) || active.has(id)));
}
