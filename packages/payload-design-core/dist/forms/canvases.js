import { flattenFields, makeID } from './model.js';
export const virtualCanvasID = '__existing_canvas__';
export const containerKinds = ['section', 'row', 'step', 'repeater'];
export function canvasItems(fields) {
    const loose = fields.filter(field => field.kind !== 'step');
    return [...(loose.length || !fields.length ? [{ id: virtualCanvasID, kind: 'step', label: 'Canvas 1', children: loose }] : []), ...fields.filter(field => field.kind === 'step')];
}
export function owningCanvas(fields, id) {
    return canvasItems(fields).find(canvas => canvas.id === id || flattenFields(canvas.children || []).some(field => field.id === id))?.id;
}
export function editPart(fields, id, update) {
    return fields.flatMap(field => {
        if (field.id === id) {
            const next = update(field);
            return next ? [next] : [];
        }
        return [{ ...field, ...(field.children ? { children: editPart(field.children, id, update) } : {}) }];
    });
}
export function organizeIssue(fields) {
    if (fields.some(field => flattenFields(field.children || []).some(child => child.kind === 'step')))
        return 'This form contains nested Steps. Keep its existing structure or move those Steps to the top level before adding canvases.';
    if (fields.some(field => field.kind === 'step') && fields.some(field => field.kind !== 'step'))
        return 'This form mixes canvases and top-level parts. Move the top-level parts into an existing canvas before adding another canvas.';
}
export function newCanvas(fields) {
    const labels = new Set(fields.map(field => field.label));
    let number = 1;
    while (labels.has(`Canvas ${number}`))
        number++;
    return { id: makeID(), kind: 'step', label: `Canvas ${number}`, width: 12, children: [] };
}
export function organizeCanvases(definition) {
    const issue = organizeIssue(definition.fields);
    if (issue)
        throw new Error(issue);
    if (definition.fields.some(field => field.kind === 'step'))
        return definition;
    return { ...definition, fields: [{ ...newCanvas([]), children: definition.fields }] };
}
/** Explicit destination: containers receive children; ordinary parts receive a preceding sibling. */
export function movePart(fields, id, target) {
    const part = flattenFields(fields).find(field => field.id === id);
    let destination = flattenFields(fields).find(field => field.id === target);
    if (destination?.layout?.kind === 'columns' && part?.layout?.kind !== 'column') {
        destination = destination.children?.[0];
        target = destination?.id || target;
    }
    if (part?.layout?.kind === 'column') {
        const owner = flattenFields(fields).find(field => field.children?.some(child => child.id === id));
        if (!owner?.children?.some(child => child.id === target))
            return fields;
    }
    if (!part || id === target || flattenFields(part.children || []).some(field => field.id === target))
        return fields;
    if (part.kind === 'step' && target !== 'root' && !fields.some(field => field.id === target && field.kind === 'step'))
        return fields;
    if (target !== 'root' && target !== virtualCanvasID && !destination)
        return fields;
    // Explicit top-level movement remains available for compatibility; never nest a Canvas.
    const next = editPart(fields, id, () => null);
    if (target === 'root' || target === virtualCanvasID)
        return [...next, part];
    if (destination && containerKinds.includes(destination.kind) && part.kind !== 'step' && part.layout?.kind !== 'column')
        return editPart(next, target, field => ({ ...field, children: [...field.children || [], part] }));
    const before = (items) => items.flatMap(field => field.id === target ? [part, field] : [{ ...field, ...(field.children ? { children: before(field.children) } : {}) }]);
    return before(next);
}
function references(value, ids) {
    if (typeof value === 'string')
        return [...ids].some(id => value === id || value.includes(`{{${id}}}`) || value.includes(`{{${id}.`) || value.includes(`[${id}]`) || value.includes(`[${id}.`));
    if (Array.isArray(value))
        return value.some(item => references(item, ids));
    return !!value && typeof value === 'object' && Object.values(value).some(item => references(item, ids));
}
export function deletionPlan(definition, id) {
    const part = flattenFields(definition.fields).find(field => field.id === id);
    if (!part)
        return { blockers: [], definition };
    const ids = new Set(flattenFields([part]).map(field => field.id));
    const blockers = [];
    if (part.layout?.kind === 'column' && flattenFields(definition.fields).some(parent => parent.children?.some(child => child.id === id) && parent.children.length === 1))
        blockers.push('Columns must retain at least one column. Delete the Columns layout instead.');
    const rules = definition.rules.filter(rule => {
        if (!references({ when: rule.when, effects: rule.effects }, ids))
            return true;
        if (part.layout?.kind === 'column') {
            blockers.push('Rule: ' + rule.name);
            return true;
        }
        const internal = rule.effects.length > 0 && rule.effects.every(effect => 'target' in effect && !['route', 'action'].includes(effect.kind) && ids.has(effect.target));
        if (internal)
            return false;
        blockers.push(`Logic: ${rule.name}`);
        return true;
    });
    for (const field of flattenFields(definition.fields))
        if (!ids.has(field.id) && references(field.expression, ids))
            blockers.push(`Calculation: ${field.label}`);
    for (const action of definition.actions)
        if (references({ when: action.when, config: action.config }, ids))
            blockers.push(`Action: ${action.name}`);
    if (definition.payment && ids.has(definition.payment.amountField))
        blockers.push('Payment amount');
    if (references(definition.workflow, ids))
        blockers.push('Entry workflow');
    if (references(definition.redirect, ids))
        blockers.push('Redirect');
    if (references(definition.confirmation, ids))
        blockers.push('Confirmation message');
    return { blockers, definition: { ...definition, fields: editPart(definition.fields, id, () => null), rules } };
}
