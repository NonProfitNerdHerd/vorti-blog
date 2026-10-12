'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { availableRules, ruleLabels, validateRuleDefinitions } from '../views/field-rules.js';
export const typeFieldDescriptions = {
    text: 'A short answer, name, or email address.',
    textarea: 'A longer plain-text answer.',
    richText: 'Formatted text with links and paragraphs.',
    number: 'A numeric value such as capacity or price.',
    date: 'A date and time. Use Event Schedule for timezone-aware events.',
    boolean: 'A yes/no checkbox.',
    select: 'One choice from your list of options.',
    media: 'An existing uploaded image or document.',
    url: 'A website, email, telephone, or internal link.',
    relationship: 'A reference to another record the author can access.',
    eventSchedule: 'Start, end, timezone, all-day settings, and recurrence for an Event.',
};
export function nextFieldID(fields, label) {
    const base = label
        .replace(/[^a-zA-Z0-9_]/g, '')
        .replace(/^[^a-zA-Z]+/, '')
        .replace(/^./, (c) => c.toLowerCase())
        .slice(0, 55) || 'field';
    let id = base, n = 2;
    while (fields.some((f) => f.id === id) || ['constructor', 'prototype', '__proto__'].includes(id))
        id = `${base}${n++}`;
    return id;
}
function RuleEditor({ rule, field, fields, change, }) {
    const related = fields.find((f) => f.id === rule.field);
    const scalar = ['text', 'textarea', 'select', 'number', 'boolean', 'date', 'url'];
    const numeric = ['minLength', 'maxLength', 'min', 'max', 'maxBytes'].includes(rule.kind);
    const needsValue = numeric ||
        ['earliest', 'latest', 'contains', 'excludes', 'protocols', 'domains', 'mimeTypes'].includes(rule.kind) ||
        (rule.kind === 'requiredWhen' && rule.operator === 'equals');
    return (_jsxs("div", { className: "pt-rule", children: [_jsx("strong", { children: ruleLabels[rule.kind] }), ['compare', 'requiredWhen'].includes(rule.kind) && (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Other field", _jsxs("select", { value: rule.field || '', onChange: (e) => change({ field: e.target.value, value: undefined }), children: [_jsx("option", { value: "", children: "Choose a field" }), fields
                                        .filter((f) => f.id !== field.id &&
                                        (rule.kind !== 'compare' || f.kind === field.kind) &&
                                        (rule.operator !== 'equals' || scalar.includes(f.kind)))
                                        .map((f) => (_jsx("option", { value: f.id, children: f.label }, f.id)))] })] }), _jsxs("label", { children: ["Condition", _jsxs("select", { value: rule.operator || '', onChange: (e) => change({ operator: e.target.value, value: undefined }), children: [_jsx("option", { value: "", children: "Choose a condition" }), (rule.kind === 'compare'
                                        ? [
                                            ['before', field.kind === 'date' ? 'Must be before' : 'Must be less than'],
                                            ['after', field.kind === 'date' ? 'Must be after' : 'Must be greater than'],
                                        ]
                                        : [
                                            ['equals', 'Equals'],
                                            ['set', 'Has a value'],
                                            ['empty', 'Is empty'],
                                        ]).map(([value, label]) => (_jsx("option", { value: value, children: label }, value)))] })] }), rule.kind === 'compare' && (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!rule.allowEqual, onChange: (e) => change({ allowEqual: e.target.checked }) }), ' ', "Allow equal values"] }))] })), needsValue && (_jsxs("label", { children: ["Rule value", rule.kind === 'requiredWhen' && related?.kind === 'boolean' ? (_jsxs("select", { value: rule.value === undefined ? '' : String(rule.value), onChange: (e) => change({ value: e.target.value === 'true' }), children: [_jsx("option", { value: "", children: "Choose" }), _jsx("option", { value: "true", children: "Yes" }), _jsx("option", { value: "false", children: "No" })] })) : rule.kind === 'requiredWhen' && related?.kind === 'select' ? (_jsxs("select", { value: String(rule.value || ''), onChange: (e) => change({ value: e.target.value }), children: [_jsx("option", { value: "", children: "Choose" }), related.options?.map((o) => (_jsx("option", { children: o }, o)))] })) : (_jsx("input", { type: numeric || (rule.kind === 'requiredWhen' && related?.kind === 'number')
                            ? 'number'
                            : ['earliest', 'latest'].includes(rule.kind)
                                ? 'datetime-local'
                                : 'text', value: String(rule.value ?? ''), onChange: (e) => change({
                            value: numeric || (rule.kind === 'requiredWhen' && related?.kind === 'number')
                                ? e.target.value === ''
                                    ? undefined
                                    : Number(e.target.value)
                                : e.target.value,
                        }) }))] })), rule.kind === 'protocols' && (_jsx("small", { children: "Comma-separated: https, http, mailto, tel, relative" })), rule.kind === 'domains' && (_jsx("small", { children: "Exact hostnames, separated by commas: example.org, www.example.org. Only website links match." })), rule.kind === 'mimeTypes' && (_jsx("small", { children: "Comma-separated MIME types: image/*, application/pdf" })), _jsxs("label", { children: ["Custom error message (optional)", _jsx("input", { maxLength: 300, value: rule.message || '', onChange: (e) => change({ message: e.target.value }), placeholder: "Use the automatic message" })] })] }));
}
export function TypeFieldBuilder({ fields, onChange, savedFields, disabled, preview, renderDefault, }) {
    const [selected, setSelected] = useState(0), [showPreview, setShowPreview] = useState(false);
    const field = fields[selected];
    const locked = !!field && savedFields.some((f) => f.id === field.id);
    const update = (patch) => onChange(fields.map((f, i) => (i === selected ? { ...f, ...patch } : f)));
    const move = (from, to) => {
        const next = [...fields];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onChange(next);
        setSelected(to);
    };
    const add = () => {
        onChange([
            ...fields,
            { id: nextFieldID(fields, 'newField'), label: 'New field', kind: 'text', public: false },
        ]);
        setSelected(fields.length);
    };
    const issues = validateRuleDefinitions(fields);
    return (_jsxs("section", { className: "pt-field-builder", children: [_jsxs("div", { className: "pt-builder-heading", children: [_jsx("h3", { children: "Content fields" }), _jsxs("button", { type: "button", "aria-expanded": showPreview, onClick: () => setShowPreview(!showPreview), children: [showPreview ? 'Hide' : 'Show', " author form preview"] })] }), showPreview && (_jsxs("section", { className: "pt-preview", children: [_jsx("h4", { children: "Try the author form" }), _jsx("p", { children: "Sample values stay in this preview and are never saved as content. Rules are enforced when content is published." }), preview] })), _jsxs("div", { className: "pt-field-layout", children: [_jsxs("div", { children: [_jsx("ol", { className: "pt-field-list", children: fields.map((f, i) => (_jsxs("li", { children: [_jsxs("button", { type: "button", "aria-pressed": selected === i, onClick: () => setSelected(i), children: [_jsx("strong", { children: f.label }), _jsxs("small", { children: [f.kind, " \u00B7 ", f.public ? 'Public' : 'Private', f.required ? ' · Required' : '', f.rules?.length
                                                            ? ` · ${f.rules.map((rule) => ruleLabels[rule.kind]).join(', ')}`
                                                            : ''] })] }), _jsxs("div", { children: [_jsx("button", { type: "button", "aria-label": `Move ${f.label} up`, disabled: disabled || i === 0, onClick: () => move(i, i - 1), children: "\u2191" }), _jsx("button", { type: "button", "aria-label": `Move ${f.label} down`, disabled: disabled || i === fields.length - 1, onClick: () => move(i, i + 1), children: "\u2193" })] })] }, i))) }), _jsx("button", { type: "button", disabled: disabled || fields.length >= 100, onClick: add, children: "Add field" })] }), field ? (_jsxs("fieldset", { disabled: disabled, className: "pt-field-settings", children: [_jsx("legend", { children: field.label }), _jsxs("label", { children: ["Label", _jsx("input", { value: field.label, onChange: (e) => update({ label: e.target.value }) })] }), _jsxs("label", { children: ["Field ID", _jsx("input", { value: field.id, disabled: locked, onChange: (e) => update({ id: e.target.value }) })] }), !locked && (_jsx("button", { type: "button", onClick: () => update({
                                    id: nextFieldID(fields.filter((_, i) => i !== selected), field.label),
                                }), children: "Suggest ID from label" })), _jsxs("label", { children: ["Field type", _jsx("select", { value: field.kind, disabled: locked, onChange: (e) => update({
                                            kind: e.target.value,
                                            rules: [],
                                            defaultValue: undefined,
                                            options: e.target.value === 'select' ? ['Option 1'] : undefined,
                                            relationTo: e.target.value === 'relationship' ? 'posts' : undefined,
                                        }), children: Object.keys(typeFieldDescriptions).map((kind) => (_jsx("option", { children: kind }, kind))) })] }), _jsx("p", { children: typeFieldDescriptions[field.kind] }), locked && (_jsx("p", { children: "This saved field\u2019s ID and type are fixed because content and Templates may reference them. Add a replacement field if needed." })), _jsxs("label", { children: ["Help text", _jsx("textarea", { value: field.helpText || '', onChange: (e) => update({ helpText: e.target.value }) })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!field.required, onChange: (e) => update({ required: e.target.checked }) }), ' ', "Required for publication"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!field.public, onChange: (e) => update({ public: e.target.checked }) }), ' ', "Public: available to Templates and Saved Views"] }), field.kind === 'select' && (_jsxs("label", { children: ["Choices (one per line)", _jsx("textarea", { value: (field.options || []).join('\n'), onChange: (e) => update({ options: e.target.value.split('\n') }) })] })), field.kind === 'relationship' && (_jsxs("label", { children: ["Related collection", _jsx("select", { value: field.relationTo || 'posts', onChange: (e) => update({ relationTo: e.target.value, defaultValue: undefined }), children: ['posts', 'pages', 'media', 'categories', 'tags', 'saved-views'].map((c) => (_jsx("option", { children: c }, c))) })] })), !['richText', 'eventSchedule', 'media', 'relationship'].includes(field.kind) && (_jsxs("label", { children: ["Default value (optional)", field.kind === 'boolean' ? (_jsxs("select", { value: field.defaultValue === undefined ? '' : String(field.defaultValue), onChange: (e) => update({
                                            defaultValue: e.target.value === '' ? undefined : e.target.value === 'true',
                                        }), children: [_jsx("option", { value: "", children: "No default" }), _jsx("option", { value: "true", children: "Yes" }), _jsx("option", { value: "false", children: "No" })] })) : field.kind === 'select' ? (_jsxs("select", { value: String(field.defaultValue || ''), onChange: (e) => update({ defaultValue: e.target.value || undefined }), children: [_jsx("option", { value: "", children: "No default" }), field.options?.map((o) => (_jsx("option", { children: o }, o)))] })) : (_jsx("input", { type: field.kind === 'number'
                                            ? 'number'
                                            : field.kind === 'date'
                                                ? 'datetime-local'
                                                : 'text', value: String(field.defaultValue ?? ''), onChange: (e) => update({
                                            defaultValue: e.target.value === ''
                                                ? undefined
                                                : field.kind === 'number'
                                                    ? Number(e.target.value)
                                                    : e.target.value,
                                        }) }))] })), ['media', 'relationship', 'richText', 'eventSchedule'].includes(field.kind) &&
                                renderDefault?.(field, (defaultValue) => update({ defaultValue })), _jsx("h4", { children: "Publication rules" }), _jsx("p", { children: "Drafts may be unfinished. These rules must pass before content can be published." }), (field.rules || []).map((rule, index) => (_jsxs("div", { children: [_jsx(RuleEditor, { rule: rule, field: field, fields: fields, change: (patch) => update({
                                            rules: field.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                                        }) }), _jsxs("button", { type: "button", onClick: () => update({ rules: field.rules.filter((_, i) => i !== index) }), children: ["Remove ", ruleLabels[rule.kind], " rule"] })] }, index))), _jsxs("label", { children: ["Add rule", _jsxs("select", { value: "", onChange: (e) => update({
                                            rules: [...(field.rules || []), { kind: e.target.value }],
                                        }), children: [_jsx("option", { value: "", children: "Choose a rule\u2026" }), availableRules(field.kind).map((kind) => (_jsx("option", { value: kind, children: ruleLabels[kind] }, kind)))] })] }), issues
                                .filter((i) => i.field === field.id)
                                .map((issue, i) => (_jsx("p", { className: "pt-error", children: issue.message }, i))), _jsxs("div", { className: "pt-wizard-actions", children: [_jsx("button", { type: "button", disabled: fields.length >= 100, onClick: () => {
                                            onChange([
                                                ...fields,
                                                {
                                                    ...structuredClone(field),
                                                    id: nextFieldID(fields, field.id),
                                                    label: `${field.label} copy`,
                                                },
                                            ]);
                                            setSelected(fields.length);
                                        }, children: "Duplicate field" }), _jsx("button", { type: "button", disabled: locked, onClick: () => {
                                            onChange(fields.filter((_, i) => i !== selected));
                                            setSelected(Math.max(0, selected - 1));
                                        }, children: "Remove field" })] })] })) : (_jsx("p", { children: "Add your first field to describe the information authors should enter." }))] })] }));
}
