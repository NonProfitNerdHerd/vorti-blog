export const ruleLabels = {
    requiredWhen: 'Required when',
    minLength: 'Minimum length',
    maxLength: 'Maximum length',
    email: 'Valid email address',
    containsEmail: 'Contains an email address',
    contains: 'Contains text',
    excludes: 'Does not contain text',
    min: 'Minimum number',
    max: 'Maximum number',
    integer: 'Whole number',
    compare: 'Compare with another field',
    earliest: 'Earliest date/time',
    latest: 'Latest date/time',
    protocols: 'Allowed link protocols',
    domains: 'Allowed website domains',
    checked: 'Must be checked',
    mimeTypes: 'Allowed media types',
    maxBytes: 'Maximum file size (bytes)',
};
export function availableRules(kind) {
    const specific = {
        text: ['minLength', 'maxLength', 'email', 'containsEmail', 'contains', 'excludes'],
        textarea: ['minLength', 'maxLength', 'email', 'containsEmail', 'contains', 'excludes'],
        number: ['min', 'max', 'integer', 'compare'],
        date: ['earliest', 'latest', 'compare'],
        url: ['protocols', 'domains'],
        boolean: ['checked'],
        media: ['mimeTypes', 'maxBytes'],
    };
    return ['requiredWhen', ...(specific[kind] || [])];
}
const empty = (value) => value === undefined || value === null || value === '';
// Offset-less date inputs are wall-clock values, compared in UTC, never server-local time.
export function fieldDate(value) {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))
        return NaN;
    const date = value.slice(0, 10), parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date)
        return NaN;
    return Date.parse(value.length === 10
        ? `${value}T00:00:00Z`
        : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
            ? value
            : `${value}Z`);
}
const csv = (value) => String(value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
const email = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export function evaluateFieldRules(fields, values, media = {}) {
    const issues = [];
    for (const f of fields) {
        const value = values[f.id];
        if (f.required && empty(value))
            issues.push({ field: f.id, message: `${f.label} is required.` });
        for (const rule of f.rules || []) {
            let valid = true;
            const target = fields.find((item) => item.id === rule.field);
            const other = target ? values[target.id] : undefined;
            if (rule.kind === 'requiredWhen') {
                const applies = rule.operator === 'set'
                    ? !empty(other)
                    : rule.operator === 'empty'
                        ? empty(other)
                        : other === rule.value;
                valid = !applies || !empty(value);
            }
            else if (empty(value) && rule.kind !== 'checked')
                continue;
            else
                switch (rule.kind) {
                    case 'minLength':
                        valid = [...String(value)].length >= Number(rule.value);
                        break;
                    case 'maxLength':
                        valid = [...String(value)].length <= Number(rule.value);
                        break;
                    case 'email':
                        valid = email.test(String(value));
                        break;
                    case 'containsEmail':
                        valid = String(value)
                            .split(/[\s<>()",;]+/)
                            .some((part) => email.test(part.replace(/[.!?]+$/, '')));
                        break;
                    case 'contains':
                        valid = String(value).includes(String(rule.value));
                        break;
                    case 'excludes':
                        valid = !String(value).includes(String(rule.value));
                        break;
                    case 'min':
                        valid = Number(value) >= Number(rule.value);
                        break;
                    case 'max':
                        valid = Number(value) <= Number(rule.value);
                        break;
                    case 'integer':
                        valid = Number.isInteger(value);
                        break;
                    case 'checked':
                        valid = value === true;
                        break;
                    case 'earliest':
                        valid = fieldDate(value) >= fieldDate(rule.value);
                        break;
                    case 'latest':
                        valid = fieldDate(value) <= fieldDate(rule.value);
                        break;
                    case 'compare': {
                        const a = f.kind === 'date' ? fieldDate(value) : Number(value);
                        const b = f.kind === 'date' ? fieldDate(other) : Number(other);
                        valid =
                            !empty(other) &&
                                Number.isFinite(a) &&
                                Number.isFinite(b) &&
                                (rule.operator === 'before'
                                    ? rule.allowEqual
                                        ? a <= b
                                        : a < b
                                    : rule.allowEqual
                                        ? a >= b
                                        : a > b);
                        break;
                    }
                    case 'protocols':
                        valid = csv(rule.value).includes(String(value).startsWith('/')
                            ? 'relative'
                            : String(value).split(':')[0].toLowerCase());
                        break;
                    case 'domains': {
                        try {
                            const url = new URL(String(value));
                            valid =
                                ['http:', 'https:'].includes(url.protocol) &&
                                    csv(rule.value).includes(url.hostname.toLowerCase());
                        }
                        catch {
                            valid = false;
                        }
                        break;
                    }
                    case 'mimeTypes':
                        valid =
                            !!media[f.id]?.mimeType &&
                                csv(rule.value).some((type) => type.endsWith('/*')
                                    ? media[f.id].mimeType.startsWith(type.slice(0, -1))
                                    : media[f.id].mimeType === type);
                        break;
                    case 'maxBytes':
                        valid =
                            typeof media[f.id]?.filesize === 'number' &&
                                media[f.id].filesize <= Number(rule.value);
                        break;
                }
            if (!valid)
                issues.push({
                    field: f.id,
                    message: rule.message?.trim() ||
                        `${f.label}: ${ruleLabels[rule.kind]}${target ? ` ${rule.operator || ''} ${target.label}${rule.allowEqual ? ' (equal allowed)' : ''}` : rule.value !== undefined ? ` ${rule.value}` : ''}.`,
                });
        }
    }
    return issues;
}
export function validateRuleDefinitions(fields) {
    const issues = [];
    const ids = new Set();
    for (const field of fields) {
        const fail = (message) => issues.push({ field: field.id, message: `${field.label}: ${message}` });
        if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(field.id) ||
            ['__proto__', 'constructor', 'prototype'].includes(field.id) ||
            ids.has(field.id))
            fail('Choose a unique field ID starting with a lowercase letter, using letters, numbers, and underscores.');
        ids.add(field.id);
        if (!field.label?.trim())
            fail('Enter a field label.');
        if (field.kind === 'select' &&
            (!field.options?.length ||
                field.options.some((option) => typeof option !== 'string' || !option.trim()) ||
                new Set(field.options).size !== field.options.length))
            fail('Enter distinct, nonempty choices.');
        if (field.rules !== undefined && (!Array.isArray(field.rules) || field.rules.length > 30)) {
            fail('Use at most 30 rules.');
            continue;
        }
        for (const rule of field.rules || []) {
            if (!rule || !availableRules(field.kind).includes(rule.kind)) {
                fail('Unsupported rule for this field.');
                continue;
            }
            if (Object.keys(rule).some((key) => !['kind', 'value', 'field', 'operator', 'allowEqual', 'message'].includes(key)))
                fail('Unknown rule setting.');
            if (rule.message !== undefined &&
                (typeof rule.message !== 'string' || rule.message.length > 300))
                fail('Messages must be text of at most 300 characters.');
            if (rule.allowEqual !== undefined && typeof rule.allowEqual !== 'boolean')
                fail('Allow equal must be a boolean.');
            if (['minLength', 'maxLength', 'min', 'max', 'maxBytes'].includes(rule.kind) &&
                (typeof rule.value !== 'number' || !Number.isFinite(rule.value)))
                fail('Enter a finite numeric bound.');
            if (['minLength', 'maxLength', 'maxBytes'].includes(rule.kind) &&
                (!Number.isInteger(rule.value) || Number(rule.value) < 0))
                fail('Enter a nonnegative whole-number bound.');
            if (['earliest', 'latest'].includes(rule.kind) && !Number.isFinite(fieldDate(rule.value)))
                fail('Enter a valid ISO date/time.');
            if (['contains', 'excludes', 'protocols', 'domains', 'mimeTypes'].includes(rule.kind) &&
                (typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 2000))
                fail('Enter a value of at most 2,000 characters.');
            if (rule.kind === 'protocols' &&
                csv(rule.value).some((v) => !['http', 'https', 'mailto', 'tel', 'relative'].includes(v)))
                fail('Choose http, https, mailto, tel, or relative.');
            if (rule.kind === 'domains' &&
                csv(rule.value).some((v) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v)))
                fail('Enter exact hostnames, without paths or wildcards.');
            if (rule.kind === 'mimeTypes' &&
                csv(rule.value).some((v) => !/^[a-z0-9.+-]+\/(?:[a-z0-9.+-]+|\*)$/.test(v)))
                fail('Enter MIME types such as image/* or application/pdf.');
            if (['compare', 'requiredWhen'].includes(rule.kind)) {
                const target = fields.find((f) => f.id === rule.field);
                if (!target || target.id === field.id) {
                    fail('Choose another existing field.');
                    continue;
                }
                if (rule.kind === 'compare' &&
                    (target.kind !== field.kind || !['before', 'after'].includes(rule.operator || '')))
                    fail('Choose a matching field type and comparison.');
                if (rule.kind === 'requiredWhen') {
                    if (!['equals', 'set', 'empty'].includes(rule.operator || ''))
                        fail('Choose a condition.');
                    if (rule.operator === 'equals' &&
                        (!['text', 'textarea', 'number', 'boolean', 'select', 'url', 'date'].includes(target.kind) ||
                            typeof rule.value !==
                                (target.kind === 'number'
                                    ? 'number'
                                    : target.kind === 'boolean'
                                        ? 'boolean'
                                        : 'string')))
                        fail('Choose a compatible comparison value.');
                    if (rule.operator === 'equals' &&
                        target.kind === 'select' &&
                        !target.options?.includes(String(rule.value)))
                        fail('Choose an existing selection option.');
                }
            }
        }
        for (const [lower, upper] of [
            ['minLength', 'maxLength'],
            ['min', 'max'],
            ['earliest', 'latest'],
        ]) {
            const bounds = (kind) => (field.rules || [])
                .filter((r) => r?.kind === kind)
                .map((r) => kind === 'earliest' || kind === 'latest' ? fieldDate(r.value) : Number(r.value));
            if (Math.max(...bounds(lower)) > Math.min(...bounds(upper)))
                fail('Minimum cannot exceed maximum.');
        }
        if (field.defaultValue !== undefined && !issues.some((issue) => issue.field === field.id)) {
            const defaults = Object.fromEntries(fields.map((f) => [f.id, f.defaultValue]));
            // Cross-field defaults are checked when both fields have defaults; media needs server facts.
            const test = {
                ...field,
                rules: field.rules?.filter((r) => !['mimeTypes', 'maxBytes', 'requiredWhen'].includes(r.kind) &&
                    (r.kind !== 'compare' || defaults[r.field] !== undefined)),
            };
            if (evaluateFieldRules([
                test,
                ...fields
                    .filter((f) => f.id !== field.id)
                    .map((f) => ({ ...f, required: false, rules: [] })),
            ], defaults).some((i) => i.field === field.id))
                fail('Default value does not satisfy the rules.');
        }
    }
    return issues;
}
