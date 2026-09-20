import { resolveContentTemplate } from './resolver.js';
import { templateFields } from './template-tree.js';
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasLexicalContent(value) {
    if (!isObject(value) || !isObject(value.root) || !Array.isArray(value.root.children))
        return false;
    const containsContent = (node) => isObject(node) &&
        ((typeof node.text === 'string' && node.text.trim().length > 0) || ['upload', 'relationship', 'block', 'inlineBlock'].includes(String(node.type)) || (Array.isArray(node.children) && node.children.some(containsContent)));
    return value.root.children.some(containsContent);
}
export function validateFieldDefinitions(fields) {
    const issues = [];
    const keys = new Set();
    for (const field of fields) {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(field.key))
            issues.push({ path: field.key, message: 'Field key must use a stable camelCase identifier' });
        if (keys.has(field.key))
            issues.push({ path: field.key, message: 'Duplicate field key' });
        keys.add(field.key);
        if (field.kind === 'group') {
            if (!field.children?.length)
                issues.push({ path: field.key, message: 'Group needs child fields' });
            else
                issues.push(...validateFieldDefinitions(field.children).map((issue) => ({ ...issue, path: `${field.key}.${issue.path}` })));
        }
        else if (field.children?.length)
            issues.push({ path: field.key, message: 'Only groups may have child fields' });
        if (field.kind === 'select' && !field.options?.length)
            issues.push({ path: field.key, message: 'Select needs options' });
    }
    return issues;
}
export function validateContentValues(type, values, requiredSection = true) {
    if (!isObject(values))
        return [{ path: '', message: 'Content values must be an object' }];
    const issues = [];
    function check(fields, object, prefix) {
        const allowed = new Set(fields.map((field) => field.key));
        for (const key of Object.keys(object))
            if (!allowed.has(key))
                issues.push({ path: `${prefix}${key}`, message: 'Unknown content field' });
        for (const field of fields) {
            const value = object[field.key];
            const path = `${prefix}${field.key}`;
            if (value == null || value === '') {
                if (requiredSection && field.required)
                    issues.push({ path, message: `${field.label} is required` });
                continue;
            }
            switch (field.kind) {
                case 'text':
                case 'textarea':
                    if (typeof value !== 'string')
                        issues.push({ path, message: 'Must be text' });
                    break;
                case 'url':
                    if (typeof value !== 'string' || !/^https?:\/\/|^\//.test(value))
                        issues.push({ path, message: 'Must be an http(s) URL or local path' });
                    break;
                case 'number':
                    if (typeof value !== 'number' || !Number.isFinite(value))
                        issues.push({ path, message: 'Must be a finite number' });
                    break;
                case 'boolean':
                    if (typeof value !== 'boolean')
                        issues.push({ path, message: 'Must be true or false' });
                    break;
                case 'select':
                    if (typeof value !== 'string' || !field.options?.includes(value))
                        issues.push({ path, message: 'Must be one of the supported options' });
                    break;
                case 'media':
                    if (!(typeof value === 'number' || typeof value === 'string' || (isObject(value) && ('id' in value))))
                        issues.push({ path, message: 'Must reference a media item' });
                    break;
                case 'date':
                    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
                        issues.push({ path, message: 'Must be a valid date' });
                    break;
                case 'group':
                    if (!isObject(value))
                        issues.push({ path, message: 'Must be an object' });
                    else
                        check(field.children ?? [], value, `${path}.`);
                    break;
            }
        }
    }
    check(type.fields, values, '');
    return issues;
}
export async function validateTemplatedContent(store, content) {
    const { sections, layout } = await resolveContentTemplate(store, content);
    const issues = [];
    // Orphaned values remain recoverable when an administrator removes a section.
    for (const section of sections) {
        const values = content.templateValues?.[section.key] ?? {};
        issues.push(...validateContentValues(section.blockType, values, section.required).map((issue) => ({ path: `templateValues.${section.key}${issue.path ? `.${issue.path}` : ''}`, message: issue.message })));
    }
    const values = (content.templateValues ?? {});
    for (const field of templateFields(layout)) {
        if (field.content?.source === 'static' || field.content?.source === 'document')
            continue;
        const value = values[field.id];
        const missing = value == null || value === '' || (Array.isArray(value) && value.length === 0) || (field.fieldType === 'richText' && !hasLexicalContent(value));
        if (field.required && missing)
            issues.push({ path: `templateValues.${field.id}`, message: `${field.label} is required` });
    }
    return issues;
}
