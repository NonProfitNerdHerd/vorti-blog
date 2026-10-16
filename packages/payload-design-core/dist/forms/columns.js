import { flattenFields, makeID } from './model.js';
import { editPart } from './canvases.js';
export const columnPresets = [[100], [50, 50], [60, 40], [40, 60], [70, 30], [30, 70], [33, 33, 34], [50, 25, 25], [25, 50, 25], [25, 25, 50], [25, 25, 25, 25]];
export const columnTracks = (field) => field.children?.map(child => `${child.layout?.kind === 'column' ? child.layout.weight : 1}fr`).join(' ');
export function createColumn(index, weight) {
    return { id: makeID(), kind: 'section', label: `Column ${index + 1}`, layout: { kind: 'column', weight }, children: [] };
}
export function canUseFullWidth(fields, id) {
    return fields.some(field => field.id === id || (field.kind === 'step' && field.children?.some(child => child.id === id)));
}
function references(value, id) {
    if (typeof value === 'string')
        return value === id || value.includes(`{{${id}}}`) || value.includes(`[${id}]`);
    if (Array.isArray(value))
        return value.some(item => references(item, id));
    return !!value && typeof value === 'object' && Object.values(value).some(item => references(item, id));
}
export function setColumnLayout(definition, id, weights) {
    const row = flattenFields(definition.fields).find(field => field.id === id && field.kind === 'row');
    if (!row || !columnPresets.some(preset => preset.join('/') === weights.join('/')))
        return { definition, error: 'Choose a supported column layout.' };
    const existing = row.layout?.kind === 'columns' ? row.children || [] : [];
    const removed = existing.slice(weights.length);
    for (const column of removed)
        if (references({ rules: definition.rules, actions: definition.actions, payment: definition.payment, workflow: definition.workflow, confirmation: definition.confirmation, redirect: definition.redirect, expressions: flattenFields(definition.fields).map(field => field.expression) }, column.id))
            return { definition, error: `${column.label} is referenced by form behavior. Update those references before removing this column.` };
    const children = weights.map((weight, index) => existing[index] ? { ...existing[index], layout: { kind: 'column', weight } } : createColumn(index, weight));
    children[children.length - 1] = { ...children.at(-1), children: [...children.at(-1).children || [], ...removed.flatMap(column => column.children || [])] };
    if (!existing.length && row.children?.length)
        children[0].children = row.children;
    return { definition: { ...definition, fields: editPart(definition.fields, id, field => ({ ...field, layout: { kind: 'columns', width: field.layout?.kind === 'columns' ? field.layout.width : 'inherit' }, children })) } };
}
