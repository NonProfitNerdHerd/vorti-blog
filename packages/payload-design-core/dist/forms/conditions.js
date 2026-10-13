import { isEmpty } from './model.js';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const includes = (a, b) => Array.isArray(a) ? a.some(v => equal(v, b)) : typeof a === 'string' && typeof b === 'string' && a.includes(b);
const number = (fn) => (a, b) => typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && fn(a, b);
/** Calendar dates compare as dates; instants require explicit offsets, never server-local time. */
export function comparableDate(value) {
    if (typeof value !== 'string')
        return undefined;
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
        return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    if (!/^\d{4}-\d\d-\d\d$/.test(value) && !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value))
        return undefined;
    const result = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
    return Number.isFinite(result) ? result : undefined;
}
const date = (fn) => (a, b) => {
    const left = comparableDate(a), right = comparableDate(b);
    return left !== undefined && right !== undefined && fn(left, right);
};
export const conditionOperators = {
    equals: equal, notEquals: (a, b) => !equal(a, b), contains: includes, notContains: (a, b) => !includes(a, b),
    in: (a, b) => Array.isArray(b) && b.some(v => equal(a, v)), notIn: (a, b) => Array.isArray(b) && !b.some(v => equal(a, v)),
    empty: a => isEmpty(a), notEmpty: a => !isEmpty(a), gt: number((a, b) => a > b), gte: number((a, b) => a >= b),
    lt: number((a, b) => a < b), lte: number((a, b) => a <= b), before: date((a, b) => a < b), after: date((a, b) => a > b),
};
export function matches(condition, answers, depth = 0) {
    if (depth > 20)
        throw new Error('Conditions cannot nest more than 20 levels.');
    if ('all' in condition)
        return condition.all.every(c => matches(c, answers, depth + 1));
    if ('any' in condition)
        return condition.any.some(c => matches(c, answers, depth + 1));
    return conditionOperators[condition.operator]?.(answers[condition.field], condition.compareField ? answers[condition.compareField] : condition.value) ?? false;
}
export function conditionReferences(condition, depth = 0) {
    if (depth > 20)
        throw new Error('Conditions cannot nest more than 20 levels.');
    if ('all' in condition || 'any' in condition)
        return ('all' in condition ? condition.all : condition.any).flatMap(c => conditionReferences(c, depth + 1));
    return [condition.field, ...(condition.compareField ? [condition.compareField] : [])];
}
