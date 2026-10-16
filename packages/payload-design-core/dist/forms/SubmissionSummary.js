import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formFields } from './registry.js';
import './summary.css';
const labels = { full: 'Full name', middle: 'Middle name / initial', first: 'First name', last: 'Last name', line1: 'Address', line2: 'Address line 2', city: 'City', region: 'State / region', postalCode: 'Postal code', country: 'Country', start: 'Start', end: 'End' };
function StructuredValue({ value }) {
    if (value === null || value === undefined || value === '')
        return _jsx("span", { className: "forms-summary-empty", children: "Not provided" });
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    if (Array.isArray(value))
        return _jsx("ol", { children: value.map((item, index) => _jsx("li", { children: _jsx(StructuredValue, { value: item }) }, index)) });
    if (typeof value === 'object')
        return _jsx("dl", { children: Object.entries(value).map(([key, item]) => _jsxs("div", { children: [_jsx("dt", { children: labels[key] || key }), _jsx("dd", { children: _jsx(StructuredValue, { value: item }) })] }, key)) });
    return String(value);
}
export function SubmissionSummary({ fields, answers, attachment }) {
    return _jsx("div", { className: "forms-summary", children: fields.map(field => {
            const value = answers[field.id];
            const registration = formFields.get(field.kind);
            if (registration?.structural)
                return field.children?.length ? _jsxs("section", { children: [_jsx("h3", { children: field.label }), _jsx(SubmissionSummary, { fields: field.children, answers: answers, attachment: attachment })] }, field.id) : null;
            let content;
            if (field.sensitive && value === undefined)
                content = _jsx("span", { children: "Sensitive answer \u2014 permission required" });
            else if (field.kind === 'repeater' && Array.isArray(value))
                content = value.length ? _jsx("ol", { children: value.map((row, index) => _jsxs("li", { children: [_jsxs("h4", { children: ["Item ", index + 1] }), _jsx(SubmissionSummary, { fields: field.children || [], answers: row && typeof row === 'object' && !Array.isArray(row) ? row : {}, attachment: attachment })] }, index)) }) : _jsx("span", { children: "No items" });
            else if (field.kind === 'upload' && Array.isArray(value))
                content = _jsx("ul", { children: value.map((id, index) => _jsx("li", { children: attachment && typeof id === 'string' ? attachment(id, field) : `Attachment ${index + 1}` }, index)) });
            else if (field.kind === 'likert' && value && typeof value === 'object' && !Array.isArray(value))
                content = _jsx("dl", { children: field.rows?.map(row => _jsxs("div", { children: [_jsx("dt", { children: row.label }), _jsx("dd", { children: field.options?.find(option => option.id === value[row.id])?.label || 'Not provided' })] }, row.id)) });
            else if (field.kind === 'signature' && value && typeof value === 'object' && !Array.isArray(value)) {
                content = value.mode === 'typed' ? _jsxs("span", { children: [String(value.name || ''), " (typed signature)"] }) : _jsx("svg", { viewBox: "0 0 500 160", role: "img", "aria-label": "Submitted drawn signature", className: "forms-summary-signature", children: Array.isArray(value.strokes) && value.strokes.map((stroke, i) => Array.isArray(stroke) ? _jsx("polyline", { points: stroke.filter(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n))).map(point => { const [x, y] = point; return `${Math.max(0, Math.min(1, x)) * 500},${Math.max(0, Math.min(1, y)) * 160}`; }).join(' '), fill: "none", stroke: "currentColor", strokeWidth: "2" }, i) : null) });
            }
            else if (registration?.choices && value !== undefined)
                content = registration.format(value, field);
            else
                content = _jsx(StructuredValue, { value: value });
            return _jsxs("section", { className: "forms-summary-answer", children: [_jsx("h3", { children: field.label }), _jsx("div", { children: content })] }, field.id);
        }) });
}
