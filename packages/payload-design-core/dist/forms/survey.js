import { formFields } from './registry.js';
const choices = ['select', 'searchSelect', 'radio', 'imageChoice', 'multiSelect', 'ranking'];
const supported = new Set([...choices, 'checkbox', 'rating', 'nps', 'likert']);
/** One accumulator per immutable revision. No individual answers or free-text fields leave it. */
export function surveyAccumulator(fields) {
    const summaries = new Map();
    const totals = new Map();
    const initialize = (nodes, repeated = false) => {
        for (const field of nodes) {
            if (field.sensitive)
                continue; // Sensitivity is inherited through containers and repeaters.
            if (supported.has(field.kind)) {
                const buckets = () => (field.options || []).map(option => ({ id: option.id, label: option.label, count: 0 }));
                summaries.set(field.id, { id: field.id, label: field.label, kind: field.kind, repeated, responses: 0,
                    buckets: choices.includes(field.kind) ? buckets() : field.kind === 'checkbox'
                        ? [{ id: 'true', label: 'Yes', count: 0 }, { id: 'false', label: 'No', count: 0 }] : [],
                    ...(field.kind === 'likert' ? { rows: (field.rows || []).map(row => ({ id: row.id, label: row.label, responses: 0, buckets: buckets() })) } : {}),
                });
            }
            initialize(field.children || [], repeated || field.kind === 'repeater');
        }
    };
    initialize(fields);
    const increment = (buckets, value, rank) => {
        const bucket = buckets.find(item => item.id === String(value));
        if (bucket) {
            bucket.count++;
            if (rank !== undefined)
                bucket.rankTotal = (bucket.rankTotal || 0) + rank;
        }
    };
    const visit = (nodes, answers) => {
        for (const field of nodes) {
            if (field.sensitive)
                continue;
            const value = answers[field.id], summary = summaries.get(field.id);
            if (summary && value !== undefined && value !== null && value !== '' && !formFields.get(field.kind)?.validate(value, field).length) {
                summary.responses++;
                if (field.kind === 'likert') {
                    for (const row of summary.rows || []) {
                        const answer = value[row.id];
                        if (answer !== undefined) {
                            increment(row.buckets, answer);
                            row.responses++;
                        }
                    }
                }
                else if (field.kind === 'rating' || field.kind === 'nps') {
                    const key = String(value);
                    if (!summary.buckets.some(bucket => bucket.id === key))
                        summary.buckets.push({ id: key, label: key, count: 0 });
                    increment(summary.buckets, value);
                    totals.set(field.id, (totals.get(field.id) || 0) + Number(value));
                }
                else if (Array.isArray(value))
                    value.forEach((item, index) => increment(summary.buckets, item, field.kind === 'ranking' ? index + 1 : undefined));
                else
                    increment(summary.buckets, value);
            }
            if (field.kind === 'repeater') {
                if (Array.isArray(value))
                    for (const row of value)
                        if (row && typeof row === 'object' && !Array.isArray(row))
                            visit(field.children || [], row);
            }
            else
                visit(field.children || [], answers);
        }
    };
    return {
        add: (answers) => visit(fields, answers),
        result: () => [...summaries.values()].map(summary => {
            const result = structuredClone(summary);
            if (['rating', 'nps'].includes(result.kind)) {
                result.buckets.sort((a, b) => Number(a.id) - Number(b.id));
                if (result.responses)
                    result.mean = (totals.get(result.id) || 0) / result.responses;
                if (result.kind === 'nps' && result.responses)
                    result.nps = 100 * result.buckets.reduce((total, bucket) => total + (Number(bucket.id) >= 9 ? bucket.count : Number(bucket.id) <= 6 ? -bucket.count : 0), 0) / result.responses;
            }
            return result;
        }),
    };
}
