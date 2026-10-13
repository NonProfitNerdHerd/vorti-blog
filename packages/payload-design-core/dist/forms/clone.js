import { flattenFields, makeID } from './model.js';
/** IDs for choices are scoped to their owning field, not globally unique. */
export function cloneFields(source) {
    const originals = new Map(flattenFields(source).map(field => [field.id, field]));
    const ids = new Map([...originals.keys()].map(id => [id, makeID()]));
    const options = new Map([...originals.values()].map(field => [field.id, new Map((field.options || []).map(option => [option.id, makeID('option')]))]));
    const rows = new Map([...originals.values()].map(field => [field.id, new Map((field.rows || []).map(row => [row.id, makeID('row')]))]));
    const option = (field, value) => typeof value === 'string' ? options.get(field)?.get(value) || value : value;
    const remapValue = (id, value) => {
        const field = originals.get(id);
        if (!field)
            return structuredClone(value);
        if (['select', 'searchSelect', 'radio', 'imageChoice', 'multiSelect', 'ranking'].includes(field.kind))
            return Array.isArray(value) ? value.map(item => option(id, item)) : option(id, value);
        if (field.kind === 'likert' && value && typeof value === 'object' && !Array.isArray(value))
            return Object.fromEntries(Object.entries(value).map(([row, answer]) => [rows.get(id)?.get(row) || row, option(id, answer)]));
        if (field.kind === 'repeater' && Array.isArray(value))
            return value.map(row => row && typeof row === 'object' && !Array.isArray(row)
                ? Object.fromEntries(Object.entries(row).map(([child, answer]) => [ids.get(child) || child, remapValue(child, answer)])) : structuredClone(row));
        // Text resembling an ID, structured names/addresses, and safe URLs stay literal.
        return structuredClone(value);
    };
    const fields = structuredClone(source);
    for (const field of flattenFields(fields)) {
        const originalID = field.id;
        if (field.defaultValue !== undefined)
            field.defaultValue = remapValue(originalID, field.defaultValue);
        for (const item of field.options || [])
            item.id = options.get(originalID).get(item.id);
        for (const item of field.rows || [])
            item.id = rows.get(originalID).get(item.id);
        if (field.expression)
            field.expression = field.expression.replace(/\[([\w.-]+)\]/g, (_, ref) => `[${ref.split('.').map(id => ids.get(id) || id).join('.')}]`);
        if (field.group)
            field.group = { ...field.group, mode: 'copy' };
        field.id = ids.get(originalID);
    }
    const condition = (value) => 'all' in value ? { all: value.all.map(condition) } : 'any' in value ? { any: value.any.map(condition) } : {
        ...value, field: ids.get(value.field) || value.field,
        ...(value.compareField ? { compareField: ids.get(value.compareField) || value.compareField } : {}),
        ...(value.value !== undefined ? { value: remapValue(value.field, value.value) } : {}),
    };
    const effect = (value) => {
        if (!('target' in value) || value.kind === 'action')
            return structuredClone(value);
        const target = ids.get(value.target) || value.target;
        if (value.kind === 'set')
            return { ...value, target, value: remapValue(value.target, value.value) };
        return { ...value, target };
    };
    return { fields, ids, condition, effect };
}
/** Duplicate in place. Copy local field behavior, not actions or global step routing. */
export function duplicateFormField(definition, id) {
    const original = flattenFields(definition.fields).find(field => field.id === id);
    if (!original)
        throw new Error('Select a field to duplicate.');
    const cloned = cloneFields([original]), copy = cloned.fields[0];
    copy.label += ' copy';
    const insert = (fields) => fields.flatMap(field => field.id === id ? [field, copy] : [{ ...field, ...(field.children ? { children: insert(field.children) } : {}) }]);
    const rules = definition.rules.flatMap(rule => {
        const effects = rule.effects.filter(effect => 'target' in effect && effect.kind !== 'action' && effect.kind !== 'route' && cloned.ids.has(effect.target)).map(cloned.effect);
        return effects.length ? [{ ...structuredClone(rule), id: makeID('rule'), name: `${rule.name} copy`, when: cloned.condition(rule.when), effects }] : [];
    });
    return { definition: { ...definition, fields: insert(definition.fields), rules: [...definition.rules, ...rules] }, selected: copy.id };
}
