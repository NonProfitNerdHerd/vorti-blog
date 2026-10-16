import { calculate, expressionReferences } from './expression.js';
import { zonedParts } from './dates.js';
import { definitionShapeIssues } from './shape.js';
import { conditionOperators, conditionReferences, matches } from './conditions.js';
import { formFields, validDate } from './registry.js';
import { formActions } from './actions.js';
import { cmsActionIssues } from './cms.js';
import { embedOrigin } from './embed.js';
import { paymentCurrencies } from './payment.js';
import { canUseFullWidth } from './columns.js';
import { flattenFields, isEmpty } from './model.js';
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const idPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/;
/** Reject dependency cycles even when their predicates do not currently match. */
function dependencyOrder(definition) {
    const fields = flattenFields(definition.fields);
    const graph = new Map(fields.map(f => [f.id, new Set()]));
    for (const field of fields) {
        if (field.expression)
            for (const ref of expressionReferences(field.expression))
                graph.get(field.id).add(ref.split('.')[0]);
        for (const child of flattenFields(field.children || []))
            graph.get(child.id).add(field.id);
    }
    for (const rule of definition.rules)
        for (const effect of rule.effects) {
            if (['visible', 'enabled', 'required', 'set', 'clear'].includes(effect.kind) && 'target' in effect)
                for (const ref of conditionReferences(rule.when))
                    graph.get(effect.target)?.add(ref);
        }
    const done = new Set(), active = new Set(), order = [];
    const visit = (id) => {
        if (active.has(id))
            throw new Error(`Circular calculation or rule dependency involving ${id}.`);
        if (done.has(id))
            return;
        active.add(id);
        graph.get(id)?.forEach(visit);
        active.delete(id);
        done.add(id);
        order.push(id);
    };
    graph.forEach((_, id) => visit(id));
    return order;
}
export function validateDefinition(definition) {
    const malformed = definitionShapeIssues(definition);
    if (malformed.length)
        return malformed;
    const issues = [];
    const add = (message, field, rule, action) => issues.push({ path: 'definition', message, field, rule, ...(action ? { action } : {}) });
    for (const key of ['origins', 'embedOrigins']) {
        if (definition.access[key].length > 20 || definition.access[key].some(origin => !embedOrigin(origin)))
            add(`${key === 'embedOrigins' ? 'Iframe hosts' : 'Submission origins'} must contain up to 20 exact HTTPS origins, without paths, credentials, or wildcards. HTTP is allowed only for localhost development.`);
    }
    if (!definition || definition.version !== 1 || !Array.isArray(definition.fields) || !Array.isArray(definition.rules) || !Array.isArray(definition.actions))
        return [{ path: 'definition', message: 'Unsupported or malformed form definition.' }];
    // Bound nesting before flattening untrusted imports.
    const bounded = (fields, depth = 0) => depth < 12 && fields.length <= 250 && fields.every(f => f && typeof f === 'object' && (!f.children || (Array.isArray(f.children) && bounded(f.children, depth + 1))));
    if (!bounded(definition.fields))
        return [{ path: 'definition', message: 'Form exceeds the supported field or nesting limits.' }];
    const fields = flattenFields(definition.fields), ids = new Set();
    if (fields.length > 250)
        add('A form can contain at most 250 fields.');
    for (const field of fields) {
        if (field.layout?.kind === 'columns') {
            if (field.kind !== 'row' || !field.children?.length || field.children.length > 4 || field.children.some(child => child.layout?.kind !== 'column'))
                add('Columns need one to four column containers.', field.id);
            if (field.layout.width === 'full' && !canUseFullWidth(definition.fields, field.id))
                add('Move Columns directly onto a Canvas to use Full Page width.', field.id);
        }
        if (field.layout?.kind === 'column' && (field.kind !== 'section' || !fields.some(parent => parent.layout?.kind === 'columns' && parent.children?.some(child => child.id === field.id))))
            add('Column containers must belong to Columns.', field.id);
        if (!idPattern.test(field.id) || unsafeKeys.has(field.id) || ids.has(field.id))
            add(`Invalid or duplicate field ID: ${field.id}.`, field.id);
        ids.add(field.id);
        const registered = formFields.get(field.kind);
        if (!registered)
            add(`Unknown field type: ${field.kind}.`, field.id);
        if (typeof field.label !== 'string' || !field.label.trim())
            add('Each field needs a label.', field.id);
        if (field.min !== undefined && field.max !== undefined && field.min > field.max)
            add('Minimum cannot exceed maximum.', field.id);
        if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength)
            add('Minimum length cannot exceed maximum length.', field.id);
        if (registered?.choices && !field.choiceSource && !field.options?.length)
            add('Add at least one option.', field.id);
        for (const options of [field.options, field.rows])
            if (options) {
                if (new Set(options.map(o => o.id)).size !== options.length || options.some(o => !idPattern.test(o.id) || unsafeKeys.has(o.id) || !o.label))
                    add('Options need unique stable IDs and labels.', field.id);
            }
        if (field.prefill?.source === 'query' && ['hidden', 'calculated', 'upload'].includes(field.kind))
            add('Protected fields cannot use URL prefilling.', field.id);
        if (field.defaultValue !== undefined && registered)
            for (const error of registered.validate(field.defaultValue, field))
                add(`Invalid default: ${error}`, field.id);
        if (field.kind === 'calculated' && !field.expression)
            add('Enter a calculation.', field.id);
        if (field.expression)
            try {
                for (const ref of expressionReferences(field.expression)) {
                    const [root, child] = ref.split('.'), target = fields.find(f => f.id === root);
                    if (!target || (child ? target.kind !== 'repeater' || !target.children?.some(c => c.id === child && formFields.get(c.kind)?.numeric) : !formFields.get(target.kind)?.numeric))
                        add(`Calculation references a missing or nonnumeric field: ${ref}.`, field.id);
                }
            }
            catch (error) {
                add(error.message, field.id);
            }
        if (field.date?.timezone)
            try {
                new Intl.DateTimeFormat('en', { timeZone: field.date.timezone }).format();
            }
            catch {
                add('Choose a valid timezone.', field.id);
            }
        if (field.date) {
            const date = field.date;
            if ((date.min && !validDate(date.min)) || (date.max && !validDate(date.max)) || (date.min && date.max && date.min > date.max))
                add('Choose valid earliest/latest dates in chronological order.', field.id);
            if ([date.minDaysFromToday, date.maxDaysFromToday].some(value => value !== undefined && !Number.isInteger(value)))
                add('Relative date bounds must be whole days.', field.id);
            if (date.minDaysFromToday !== undefined && date.maxDaysFromToday !== undefined && date.minDaysFromToday > date.maxDaysFromToday)
                add('Earliest relative date cannot follow the latest date.', field.id);
            if (date.leadMinutes !== undefined && (!Number.isFinite(date.leadMinutes) || date.leadMinutes < 0))
                add('Lead time must be a nonnegative number of minutes.', field.id);
            if (date.incrementMinutes !== undefined && (!Number.isInteger(date.incrementMinutes) || date.incrementMinutes < 1 || date.incrementMinutes > 1440))
                add('Choose a time increment between 1 and 1440 minutes.', field.id);
            if (date.excludedWeekdays?.some(day => !Number.isInteger(day) || day < 0 || day > 6))
                add('Choose valid excluded weekdays.', field.id);
            if (date.blackoutDates?.some(day => !validDate(day)) || date.allowedRanges?.some(range => !validDate(range.start) || !validDate(range.end) || range.start > range.end))
                add('Choose valid blackout dates and chronological available ranges.', field.id);
            if (date.businessHours?.some(hours => !Number.isInteger(hours.weekday) || hours.weekday < 0 || hours.weekday > 6 || !validTime(hours.start) || !validTime(hours.end) || hours.start >= hours.end))
                add('Business hours need a weekday and a start time before the end time. Split overnight hours across two days.', field.id);
        }
    }
    const checkCondition = (condition, rule, depth = 0) => {
        if (!condition || depth > 20) {
            add('Invalid or overly nested condition.', undefined, rule);
            return;
        }
        if ('all' in condition || 'any' in condition) {
            const children = 'all' in condition ? condition.all : condition.any;
            if (!Array.isArray(children) || children.length > 100) {
                add('Invalid condition group.', undefined, rule);
                return;
            }
            children.forEach(c => checkCondition(c, rule, depth + 1));
            return;
        }
        const field = fields.find(f => f.id === condition.field);
        if (!field || !conditionOperators[condition.operator])
            add('Condition references an invalid field or operator.', condition.field, rule);
        const other = fields.find(f => f.id === condition.compareField);
        if (condition.compareField && (!other || other.kind !== field?.kind))
            add('Compare fields of the same type.', condition.field, rule);
        if (['gt', 'gte', 'lt', 'lte'].includes(condition.operator) && !formFields.get(field?.kind || '')?.numeric)
            add('Numeric comparisons need a numeric field.', condition.field, rule);
        if (['before', 'after'].includes(condition.operator) && !['date', 'datetime', 'time'].includes(field?.kind || ''))
            add('Date comparisons need date fields.', condition.field, rule);
    };
    const ruleIDs = new Set();
    for (const rule of definition.rules) {
        if (!rule || !idPattern.test(rule.id) || ruleIDs.has(rule.id) || !Array.isArray(rule.effects)) {
            add('Rules need unique IDs and valid effects.');
            continue;
        }
        ruleIDs.add(rule.id);
        checkCondition(rule.when, rule.id);
        for (const effect of rule.effects) {
            if ('target' in effect && effect.kind !== 'action' && !ids.has(effect.target))
                add('Rule target no longer exists.', effect.target, rule.id);
            if (effect.kind === 'action' && !definition.actions.some(a => a.id === effect.target))
                add('Action target no longer exists.', undefined, rule.id);
            if (effect.kind === 'route' && fields.find(f => f.id === effect.target)?.kind !== 'step')
                add('Routing must target a canvas.', effect.target, rule.id);
        }
    }
    const actionIDs = new Set();
    for (const action of definition.actions) {
        if (!action || !idPattern.test(action.id) || actionIDs.has(action.id)) {
            add('Actions need unique valid IDs.');
            continue;
        }
        actionIDs.add(action.id);
        const registration = formActions.get(action.kind);
        if (!registration)
            add(`Unknown action: ${action.kind}.`, undefined, undefined, action.id);
        else
            for (const error of [...registration.validate(action.config || {}), ...cmsActionIssues(action, definition)])
                add(`${action.name}: ${error}`, undefined, undefined, action.id);
        if (action.when)
            checkCondition(action.when, action.id);
    }
    try {
        dependencyOrder(definition);
    }
    catch (error) {
        add(error.message);
    }
    if (definition.redirect)
        try {
            const url = new URL(definition.redirect, 'https://form.local');
            if (url.origin !== 'https://form.local' || !definition.redirect.startsWith('/') || definition.redirect.startsWith('//'))
                add('Confirmation redirects must be local paths.');
        }
        catch {
            add('Invalid confirmation redirect.');
        }
    if (definition.payment && !fields.some(f => f.id === definition.payment?.amountField && f.kind === 'calculated'))
        add('Payment amount must use a calculated field.');
    if (definition.payment && (!['stripe', 'simulator'].includes(definition.payment.provider) || paymentCurrencies[definition.payment.currency] === undefined))
        add('Choose a supported payment provider and currency.');
    if (definition.payment && fields.some(field => field.kind === 'repeater' && flattenFields(field.children || []).some(child => child.id === definition.payment?.amountField)))
        add('Payment amount must be a total outside repeatable groups.');
    if (!definition.payment && definition.actions.some(action => action.requiresPayment))
        add('Configure payments before making actions wait for payment success.');
    return issues;
}
export function evaluateForm(definition, input) {
    const answers = {}, states = {}, fields = flattenFields(definition.fields);
    const issues = [], parents = new Map(), repeated = new Set();
    for (const f of fields) {
        for (const child of f.children || [])
            parents.set(child.id, f.id);
        if (f.kind === 'repeater')
            flattenFields(f.children || []).forEach(child => repeated.add(child.id));
        states[f.id] = { visible: true, enabled: !f.disabled, required: !!f.required };
        if (!formFields.get(f.kind)?.structural && !repeated.has(f.id)) {
            const value = f.kind === 'hidden' || f.kind === 'calculated' ? f.defaultValue : input[f.id] ?? f.defaultValue;
            if (value !== undefined)
                answers[f.id] = structuredClone(value);
        }
    }
    const matched = new Set(), actions = new Set();
    const result = { answers, states, matchedRules: [], actions: [], confirmation: definition.confirmation, issues };
    for (const id of dependencyOrder(definition)) {
        const field = fields.find(f => f.id === id);
        if (!field || repeated.has(id))
            continue;
        const state = states[id];
        for (const rule of definition.rules) {
            if (!matches(rule.when, answers))
                continue;
            for (const effect of rule.effects) {
                if (!('target' in effect) || effect.target !== id || ['route', 'action'].includes(effect.kind))
                    continue;
                matched.add(rule.id);
                if (effect.kind === 'visible')
                    state.visible = effect.value;
                if (effect.kind === 'enabled')
                    state.enabled = effect.value;
                if (effect.kind === 'required')
                    state.required = effect.value;
                if (effect.kind === 'style')
                    state.style = effect.value;
                if (effect.kind === 'set')
                    answers[id] = structuredClone(effect.value);
                if (effect.kind === 'clear')
                    delete answers[id];
            }
        }
        const parent = parents.get(id);
        if (parent) {
            if (!states[parent].visible)
                state.visible = false;
            if (!states[parent].enabled)
                state.enabled = false;
        }
        if (!state.visible || !state.enabled)
            delete answers[id];
        else if (field.kind === 'calculated' && field.expression)
            try {
                answers[id] = calculate(field.expression, answers);
            }
            catch (error) {
                issues.push({ path: id, field: id, message: error.message });
            }
    }
    for (const rule of definition.rules)
        if (matches(rule.when, answers)) {
            matched.add(rule.id);
            for (const effect of rule.effects) {
                if (effect.kind === 'confirmation')
                    result.confirmation = effect.message;
                if (effect.kind === 'route')
                    result.route = effect.target;
                if (effect.kind === 'action')
                    actions.add(effect.target);
            }
        }
    const targetedActions = new Set(definition.rules.flatMap(rule => rule.effects.filter(effect => effect.kind === 'action').map(effect => effect.target)));
    for (const action of definition.actions)
        if ((!targetedActions.has(action.id) && !action.when) || (action.when && matches(action.when, answers)))
            actions.add(action.id);
    result.matchedRules = [...matched];
    result.actions = [...actions];
    return result;
}
export function validateAnswers(definition, input, options = {}) {
    const result = evaluateForm(definition, input), fields = flattenFields(definition.fields);
    const repeated = new Set(fields.filter(f => f.kind === 'repeater').flatMap(f => flattenFields(f.children || []).map(c => c.id)));
    const add = (field, message, path = field.id) => result.issues.push({ field: field.id, path, message: field.errorMessage || `${field.label}: ${message}` });
    for (const key of Object.keys(input))
        if (!fields.some(f => f.id === key && !formFields.get(f.kind)?.structural && !repeated.has(key)))
            result.issues.push({ path: key, message: 'Unknown answer field.' });
    const validate = (field, value, required, path) => {
        if (isEmpty(value) || (['consent', 'terms', 'checkbox'].includes(field.kind) && value === false)) {
            if (required && !options.partial)
                add(field, 'This answer is required.', path);
            return;
        }
        const registration = formFields.get(field.kind);
        if (!registration || registration.structural)
            return;
        const errors = registration.validate(value, { ...field, required });
        errors.forEach(error => add(field, error, path));
        if (errors.length)
            return;
        if (typeof value === 'string') {
            if (field.minLength !== undefined && value.length < field.minLength)
                add(field, `Enter at least ${field.minLength} characters.`, path);
            if (field.maxLength !== undefined && value.length > field.maxLength)
                add(field, `Enter at most ${field.maxLength} characters.`, path);
        }
        if (field.kind === 'date' && typeof value === 'string' && field.date)
            validateDate(field, value, options.now || new Date()).forEach(error => add(field, error, path));
        if (['time', 'datetime', 'dateRange'].includes(field.kind) && field.date)
            validateTemporal(field, value, options.now || new Date()).forEach(error => add(field, error, path));
        if (field.kind === 'repeater' && Array.isArray(value))
            value.forEach((row, index) => {
                const values = row;
                for (const key of Object.keys(values))
                    if (!field.children?.some(c => c.id === key))
                        add(field, 'Unknown repeated answer.', `${path}.${index}.${key}`);
                field.children?.forEach(child => validate(child, values[child.id], !!child.required, `${path}.${index}.${child.id}`));
            });
    };
    for (const field of fields)
        if (!repeated.has(field.id) && result.states[field.id]?.visible && result.states[field.id]?.enabled)
            validate(field, result.answers[field.id], result.states[field.id].required, field.id);
    return result;
}
export function validateDate(field, value, now) {
    if (!validDate(value))
        return ['Choose a valid calendar date.'];
    const date = field.date || {}, errors = [];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: date.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const shift = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    if ((date.min && value < date.min) || (date.minDaysFromToday !== undefined && value < shift(date.minDaysFromToday)))
        errors.push('This date is too early.');
    if ((date.max && value > date.max) || (date.maxDaysFromToday !== undefined && value > shift(date.maxDaysFromToday)))
        errors.push('This date is too late.');
    if (date.blackoutDates?.includes(value) || date.excludedWeekdays?.includes(new Date(`${value}T00:00:00Z`).getUTCDay()))
        errors.push('This date is unavailable.');
    if (date.allowedRanges?.length && !date.allowedRanges.some(range => value >= range.start && value <= range.end))
        errors.push('Choose a date in an available range.');
    return errors;
}
const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
/** Date-only constraints use calendar days; lead time uses elapsed instants across DST changes. */
export function validateTemporal(field, value, now) {
    const date = field.date || {}, errors = [];
    if (field.kind === 'dateRange' && value && typeof value === 'object' && !Array.isArray(value)) {
        const start = String(value.start || ''), end = String(value.end || '');
        errors.push(...validateDate(field, start, now), ...validateDate(field, end, now));
        if (!validDate(start) || !validDate(end) || start > end)
            return [...errors, 'Choose a chronological date range.'];
        const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
        const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
        if (date.blackoutDates?.some(day => day >= start && day <= end) || date.excludedWeekdays?.some(day => days >= 6 || (day - weekday + 7) % 7 <= days))
            errors.push('The range includes an unavailable date.');
        if (date.allowedRanges?.length && !date.allowedRanges.some(range => start >= range.start && end <= range.end))
            errors.push('The entire range must fit within one available period.');
        return [...new Set(errors)];
    }
    if (typeof value !== 'string')
        return ['Choose a valid time.'];
    let time = value, weekday;
    if (field.kind === 'datetime') {
        const instant = new Date(value);
        if (!Number.isFinite(instant.getTime()) || !/(Z|[+-]\d\d:\d\d)$/.test(value))
            return ['Choose a date and time with an explicit timezone.'];
        const wall = zonedParts(instant, date.timezone || 'UTC'), day = wall.slice(0, 10);
        time = wall.slice(11, 16);
        weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        errors.push(...validateDate(field, day, now));
        if (date.leadMinutes !== undefined && instant.getTime() < now.getTime() + date.leadMinutes * 60000)
            errors.push(`Choose a time at least ${date.leadMinutes} minutes from now.`);
        if (date.incrementMinutes && (instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0))
            errors.push('Choose a time on the configured minute interval.');
    }
    if (!validTime(time))
        return [...errors, 'Choose a valid time.'];
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if (date.incrementMinutes && minutes % date.incrementMinutes !== 0)
        errors.push(`Choose a time in ${date.incrementMinutes}-minute increments.`);
    if (date.businessHours?.length && !date.businessHours.some(hours => (weekday === undefined || hours.weekday === weekday) && time >= hours.start && time < hours.end))
        errors.push('Choose a time during business hours.');
    return errors;
}
