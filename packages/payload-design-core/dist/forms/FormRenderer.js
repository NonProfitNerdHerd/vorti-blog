'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ContactInput } from './ContactInput.js';
import { GraphRenderer } from './GraphRenderer.js';
import { RankingInput } from './RankingInput.js';
import { widthFraction, widthStyle } from './contact.js';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { evaluateForm, validateAnswers } from './engine.js';
import { formFields } from './registry.js';
import { flattenFields, isEmpty } from './model.js';
import './forms.css';
import { wallTimeToInstant, zonedParts } from './dates.js';
import { BookingInput } from './BookingInput.js';
import { FormColumns } from './FormColumns.js';
// Called from telemetry effects and interaction handlers, never to derive rendered output.
const measurementTime = () => Date.now();
export const fieldRenderers = new Map();
export function registerFieldRenderer(kind, renderer) {
    if (fieldRenderers.has(kind))
        throw new Error(`Renderer already exists: ${kind}`);
    fieldRenderers.set(kind, renderer);
}
const TextInput = ({ field, value, onChange, id, disabled, describedBy, invalid }) => {
    const props = { id, disabled, 'aria-describedby': describedBy, 'aria-invalid': invalid, placeholder: field.placeholder,
        value: typeof value === 'string' || typeof value === 'number' ? value : '',
        onChange: (e) => onChange(formFields.get(field.kind)?.numeric ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) };
    return field.kind === 'textarea' || field.kind === 'content' ? _jsx("textarea", { ...props, rows: 4 }) :
        _jsx("input", { ...props, type: field.kind === 'slider' ? 'range' : formFields.get(field.kind)?.input || 'text', min: field.min, max: field.max, step: field.kind === 'currency' ? '0.01' : 'any' });
};
const CheckboxInput = ({ field, value, onChange, id, disabled, describedBy, invalid }) => _jsxs("label", { className: "forms-check", children: [_jsx("input", { type: "checkbox", id: id, checked: value === true, disabled: disabled, "aria-describedby": describedBy, "aria-invalid": invalid, onChange: e => onChange(e.target.checked) }), field.placeholder || 'I agree'] });
const DateTimeInput = ({ field, value, onChange, id, disabled }) => {
    const timezone = field.date?.timezone || 'UTC';
    const [local, setLocal] = useState(typeof value === 'string' && Number.isFinite(Date.parse(value)) ? zonedParts(new Date(value), timezone) : '');
    const [error, setError] = useState(''), [fold, setFold] = useState('reject');
    const apply = (wall, choice) => {
        setLocal(wall);
        setFold(choice);
        try {
            onChange(wall ? wallTimeToInstant(wall, timezone, choice) : null);
            setError('');
        }
        catch (error) {
            onChange(null);
            setError(error.message);
        }
    };
    return _jsxs(_Fragment, { children: [_jsx("input", { id: id, type: "datetime-local", disabled: disabled, value: local, onChange: e => apply(e.target.value, fold) }), _jsxs("small", { children: ["Timezone: ", timezone] }), _jsxs("label", { children: ["When clocks repeat a time", _jsxs("select", { disabled: disabled, value: fold, onChange: e => apply(local, e.target.value), children: [_jsx("option", { value: "reject", children: "Ask me to choose" }), _jsx("option", { value: "earlier", children: "Earlier occurrence" }), _jsx("option", { value: "later", children: "Later occurrence" })] })] }), error && _jsx("p", { role: "alert", children: error })] });
};
const StructuredInput = ({ field, value, onChange, id, disabled }) => {
    const keys = field.kind === 'name' ? ['first', 'last'] : field.kind === 'dateRange' ? ['start', 'end'] : ['line1', 'line2', 'city', 'region', 'postalCode', 'country'];
    const values = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return _jsx("div", { className: "forms-columns", children: keys.map((key, i) => _jsxs("label", { children: [key.replace(/([A-Z])/g, ' $1'), _jsx("input", { id: i === 0 ? id : `${id}-${key}`, disabled: disabled, type: field.kind === 'dateRange' ? 'date' : 'text', value: String(values[key] || ''), onChange: e => onChange({ ...values, [key]: e.target.value }) })] }, key)) });
};
const ChoiceInput = ({ field, value, onChange, id, disabled, describedBy }) => {
    const [search, setSearch] = useState('');
    const options = field.options || [], many = field.kind === 'multiSelect', selected = Array.isArray(value) ? value : [];
    if (['select', 'searchSelect'].includes(field.kind))
        return _jsxs(_Fragment, { children: [field.kind === 'searchSelect' && _jsx("input", { "aria-label": `Search ${field.label} options`, type: "search", value: search, disabled: disabled, onChange: e => setSearch(e.target.value) }), _jsxs("select", { id: id, disabled: disabled, "aria-describedby": describedBy, value: String(value || ''), onChange: e => onChange(e.target.value), children: [_jsx("option", { value: "", children: "Choose\u2026" }), options.filter(o => o.id === value || o.label.toLowerCase().includes(search.toLowerCase())).map(o => _jsx("option", { value: o.id, children: o.label }, o.id))] })] });
    return _jsx("div", { id: id, role: "group", "aria-label": field.label, className: "forms-choices", children: options.map(option => _jsxs("label", { className: "forms-check", children: [field.kind === 'imageChoice' && option.image && /^https?:\/\//.test(option.image) && _jsx("img", { src: option.image, alt: "", width: 100, height: 70, loading: "lazy" }), _jsx("input", { type: many ? 'checkbox' : 'radio', name: id, disabled: disabled, checked: many ? selected.includes(option.id) : value === option.id, onChange: () => onChange(many ? selected.includes(option.id) ? selected.filter(v => v !== option.id) : [...selected, option.id] : option.id) }), option.label] }, option.id)) });
};
const ScaleInput = ({ field, value, onChange, id, disabled }) => {
    const start = field.kind === 'nps' ? 0 : field.min ?? 1, end = Math.min(field.max ?? (field.kind === 'nps' ? 10 : 5), 20);
    return _jsx("div", { id: id, role: "group", "aria-label": field.label, className: "forms-scale", children: Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i).map(n => _jsx("button", { type: "button", disabled: disabled, "aria-pressed": n === value, onClick: () => onChange(n), children: n }, n)) });
};
const MatrixInput = ({ field, value, onChange, id, disabled }) => {
    const values = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return _jsx("div", { id: id, className: "forms-matrix", children: field.rows?.map(row => _jsxs("fieldset", { children: [_jsx("legend", { children: row.label }), field.options?.map(option => _jsxs("label", { className: "forms-check", children: [_jsx("input", { type: "radio", name: `${id}-${row.id}`, disabled: disabled, checked: values[row.id] === option.id, onChange: () => onChange({ ...values, [row.id]: option.id }) }), option.label] }, option.id))] }, row.id)) });
};
const UploadInput = ({ field, value, onChange, id, disabled, onUpload }) => {
    const [progress, setProgress] = useState(), [error, setError] = useState('');
    const [files, setFiles] = useState({});
    const references = Array.isArray(value) ? value.map(String) : [];
    return _jsxs("div", { children: [_jsx("input", { id: id, type: "file", disabled: disabled || progress !== undefined || !onUpload, multiple: (field.files?.maxCount || 1) > 1, accept: field.files?.mimeTypes.join(','), onChange: async (e) => {
                    if (!onUpload)
                        return;
                    const chosen = Array.from(e.target.files || []);
                    if (references.length + chosen.length > (field.files?.maxCount || 1)) {
                        setError('Too many files. Remove a file first.');
                        return;
                    }
                    setError('');
                    const next = [...references];
                    try {
                        for (const file of chosen) {
                            if (file.size > (field.files?.maxBytes || 10 * 1024 * 1024))
                                throw new Error('The file exceeds the allowed size.');
                            setProgress(0);
                            const uploaded = await onUpload(file, field, setProgress);
                            next.push(uploaded.id);
                            setFiles(old => ({ ...old, [uploaded.id]: uploaded }));
                            onChange([...next]);
                        }
                    }
                    catch (error) {
                        setError(error.message);
                    }
                    finally {
                        setProgress(undefined);
                        e.target.value = '';
                    }
                } }), !onUpload && _jsx("p", { children: "Uploads are unavailable in this preview." }), progress !== undefined && _jsx("progress", { max: 100, value: progress, "aria-label": "Upload progress" }), error && _jsx("p", { role: "alert", children: error }), _jsx("ul", { children: references.map(ref => _jsxs("li", { children: [files[ref]?.name || 'Saved attachment', " ", _jsx("small", { children: files[ref]?.status || 'Previously uploaded' }), " ", _jsxs("button", { type: "button", disabled: disabled, onClick: () => onChange(references.filter(v => v !== ref)), children: ["Remove ", files[ref]?.name || 'attachment'] })] }, ref)) })] });
};
const SignatureInput = ({ value, onChange, id, disabled }) => {
    const canvas = useRef(null), drawing = useRef(false);
    const values = value && typeof value === 'object' && !Array.isArray(value) ? value : { mode: 'typed' };
    const strokes = useMemo(() => (Array.isArray(values.strokes) ? values.strokes : []), [values.strokes]);
    useEffect(() => {
        const ctx = canvas.current?.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, 500, 160);
        ctx.strokeStyle = '#171717';
        ctx.lineWidth = 2;
        for (const stroke of strokes) {
            ctx.beginPath();
            stroke.forEach(([x, y], i) => i ? ctx.lineTo(x * 500, y * 160) : ctx.moveTo(x * 500, y * 160));
            ctx.stroke();
        }
    }, [strokes]);
    return _jsxs("div", { children: [_jsxs("label", { children: ["Signature method", _jsxs("select", { id: `${id}-mode`, disabled: disabled, value: String(values.mode), onChange: e => onChange({ mode: e.target.value }), children: [_jsx("option", { value: "typed", children: "Type my name" }), _jsx("option", { value: "drawn", children: "Draw signature" })] })] }), values.mode === 'typed' ? _jsx("input", { id: id, "aria-label": "Full name as signature", disabled: disabled, value: String(values.name || ''), onChange: e => onChange({ mode: 'typed', name: e.target.value }) }) : _jsxs(_Fragment, { children: [_jsx("canvas", { ref: canvas, id: id, width: 500, height: 160, "aria-label": "Draw signature; choose Type my name for keyboard entry", className: "forms-signature", onPointerDown: e => { if (disabled)
                            return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); onChange({ mode: 'drawn', strokes: [...strokes, [[(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]] }); }, onPointerMove: e => { if (!drawing.current || disabled)
                            return; const r = e.currentTarget.getBoundingClientRect(); const point = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; onChange({ mode: 'drawn', strokes: [...strokes.slice(0, -1), [...(strokes.at(-1) || []), point]] }); }, onPointerUp: () => { drawing.current = false; }, onPointerCancel: () => { drawing.current = false; } }), _jsx("button", { type: "button", disabled: disabled, onClick: () => onChange({ mode: 'drawn', strokes: [] }), children: "Clear signature" })] })] });
};
for (const kind of ['text', 'textarea', 'email', 'phone', 'url', 'number', 'currency', 'slider', 'date', 'time'])
    registerFieldRenderer(kind, TextInput);
registerFieldRenderer('datetime', DateTimeInput);
for (const kind of ['checkbox', 'consent', 'terms'])
    registerFieldRenderer(kind, CheckboxInput);
for (const kind of ['name', 'address'])
    registerFieldRenderer(kind, ContactInput);
registerFieldRenderer('dateRange', StructuredInput);
fieldRenderers.set('phone', props => props.field.contact ? _jsx(ContactInput, { ...props }) : _jsx(TextInput, { ...props }));
for (const kind of ['select', 'searchSelect', 'radio', 'multiSelect', 'imageChoice'])
    registerFieldRenderer(kind, ChoiceInput);
for (const kind of ['rating', 'nps'])
    registerFieldRenderer(kind, ScaleInput);
registerFieldRenderer('likert', MatrixInput);
registerFieldRenderer('ranking', RankingInput);
registerFieldRenderer('upload', UploadInput);
registerFieldRenderer('signature', SignatureInput);
export function FormRenderer(props) {
    return props.definition.graph?.enabled ? _jsx(GraphRenderer, { ...props }) : _jsx(StandardFormRenderer, { ...props });
}
function StandardFormRenderer({ definition, initialAnswers = {}, preview, disabled, onChange, onSubmit, onSave, onUpload, onEvent, onAnalyticsConsent, showLogic, booking, hideActions, renderFieldIDs }) {
    const [raw, setRaw] = useState(initialAnswers), [step, setStep] = useState(0);
    const [errors, setErrors] = useState([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const [consent, setConsent] = useState(false), [review, setReview] = useState(false);
    const uid = useId(), root = useRef(null), summary = useRef(null), [started, setStarted] = useState(false);
    const enteredAt = useRef(0);
    const measuring = definition.access.analytics && (!definition.access.analyticsConsent || consent) && !preview;
    useEffect(() => { onAnalyticsConsent?.(consent); }, [consent, onAnalyticsConsent]);
    useEffect(() => {
        if (measuring) {
            onEvent?.('view', { consent });
            if (started)
                onEvent?.('start', { consent });
        }
    }, [measuring, consent, started, onEvent]);
    const evaluation = useMemo(() => evaluateForm(definition, raw), [definition, raw]);
    const report = (type, data = {}) => {
        if (measuring)
            onEvent?.(type, { ...data, consent });
    };
    const change = (id, value) => {
        const next = { ...raw, [id]: value };
        setRaw(next);
        onChange?.(next);
        setErrors(old => old.filter(error => error.field !== id));
        if (!started)
            setStarted(true);
    };
    const active = definition.fields.filter(f => evaluation.states[f.id]?.visible && f.kind !== 'hidden' && (!renderFieldIDs || renderFieldIDs.includes(f.id)));
    const groups = definition.mode === 'conversational' ? active.map(f => ({ id: f.id, label: f.label, fields: [f] })) :
        active.some(f => f.kind === 'step') ? active.map(f => ({ id: f.id, label: f.label, fields: f.kind === 'step' ? f.children || [] : [f] })) : [{ id: 'form', label: 'Your answers', fields: active }];
    const current = Math.min(step, Math.max(0, groups.length - 1)), group = groups[current];
    const groupID = definition.mode === 'standard' ? 'form' : group?.id;
    useEffect(() => {
        enteredAt.current = measurementTime();
        if (!measuring || !groupID)
            return;
        onEvent?.('step', { step: groupID, consent });
        const leave = () => onEvent?.('step-exit', { step: groupID, durationMs: Math.min(86400000, measurementTime() - enteredAt.current), consent });
        window.addEventListener('pagehide', leave);
        return () => window.removeEventListener('pagehide', leave);
    }, [groupID, measuring, onEvent, consent]);
    const presentErrors = (issues, measured = false) => { setErrors(issues); if (!measured)
        report('error', { fields: [...new Set(issues.map(e => e.field).filter(Boolean))] }); requestAnimationFrame(() => summary.current?.focus()); };
    const navigate = (index) => { report('step-exit', { step: groupID, durationMs: Math.min(86400000, measurementTime() - enteredAt.current) }); setStep(index); setReview(false); requestAnimationFrame(() => root.current?.querySelector('.forms-step-heading')?.focus()); };
    const next = () => {
        const scope = new Set(flattenFields(group?.fields || []).map(f => f.id));
        const issues = validateAnswers(definition, raw).issues.filter(issue => scope.has(issue.field || ''));
        if (issues.length) {
            presentErrors(issues);
            return;
        }
        setErrors([]);
        if (evaluation.route) {
            const index = groups.findIndex(g => g.id === evaluation.route);
            if (index > current) {
                navigate(index);
                return;
            }
        }
        if (current < groups.length - 1)
            navigate(current + 1);
        else
            setReview(true);
    };
    const submit = async () => {
        const result = validateAnswers(definition, raw);
        if (result.issues.length) {
            presentErrors(result.issues);
            return;
        }
        setBusy(true);
        setMessage('');
        try {
            const response = onSubmit ? await onSubmit(result.answers) : { message: preview ? 'Preview validated. Nothing was submitted.' : 'Submission is not configured.' };
            if (response.errors?.length)
                presentErrors(response.errors, response.analyticsRecorded);
            else {
                setErrors([]);
                setMessage(response.message || evaluation.confirmation);
                if (onSubmit)
                    report('accepted');
            }
            if (response.redirect?.startsWith('/') && !response.redirect.startsWith('//'))
                window.location.assign(response.redirect);
        }
        catch (error) {
            setMessage(error.message || 'Could not submit. Your answers are still here; please retry.');
        }
        finally {
            setBusy(false);
        }
    };
    const reviewAnswers = _jsx("dl", { className: "forms-review", children: flattenFields(definition.fields).filter(f => !formFields.get(f.kind)?.structural && f.kind !== 'hidden' && evaluation.states[f.id]?.visible && !isEmpty(evaluation.answers[f.id])).map(f => _jsxs(React.Fragment, { children: [_jsx("dt", { children: f.label }), _jsx("dd", { children: formFields.get(f.kind)?.format(evaluation.answers[f.id], f) })] }, f.id)) });
    const render = (field, parent) => {
        const state = parent ? { visible: true, enabled: true, required: !!field.required } : evaluation.states[field.id];
        if (!state?.visible || field.kind === 'hidden')
            return null;
        const value = parent ? parent.values[field.id] : evaluation.answers[field.id];
        const update = (value) => parent ? parent.change(field.id, value) : change(field.id, value);
        const id = `${uid}-${parent?.prefix || ''}${field.id}`, issues = errors.filter(e => e.path === (parent ? `${parent.prefix}${field.id}` : field.id));
        const Input = fieldRenderers.get(field.kind), off = disabled || busy || !state.enabled;
        const title = _jsxs("label", { htmlFor: id, children: [field.label, state.required && _jsx("span", { "aria-label": "required", children: " *" })] });
        let content;
        if (field.kind === 'heading')
            content = _jsx("h3", { children: field.label });
        else if (field.kind === 'content')
            content = _jsx("p", { children: field.help || field.label });
        else if (field.kind === 'divider')
            content = _jsx("hr", {});
        else if (field.kind === 'review')
            content = reviewAnswers;
        else if (field.layout?.kind === 'columns')
            content = _jsx(FormColumns, { field: field, preview: preview, disabled: off, children: field.children?.map(f => render(f, parent)) });
        else if (field.layout?.kind === 'column')
            content = _jsx("fieldset", { className: "forms-layout-column", disabled: off, "aria-label": field.label, children: _jsx("div", { className: "forms-grid", children: field.children?.map(f => render(f, parent)) }) });
        else if (['section', 'row', 'step'].includes(field.kind))
            content = _jsxs("fieldset", { disabled: off, children: [_jsx("legend", { children: field.label }), _jsx("div", { className: "forms-grid", children: field.children?.map(f => render(f, parent)) })] });
        else if (field.kind === 'datetime' && field.date?.resource)
            content = _jsxs(_Fragment, { children: [title, _jsx(BookingInput, { field: field, path: parent ? `${parent.prefix}${field.id}` : field.id, id: id, value: typeof value === 'string' ? value : undefined, disabled: off, adapter: preview ? undefined : booking, onChange: update })] });
        else if (field.kind === 'calculated')
            content = _jsxs(_Fragment, { children: [title, _jsx("output", { id: id, children: field.currency ? new Intl.NumberFormat(definition.locale, { style: 'currency', currency: field.currency }).format(Number(value || 0)) : String(value ?? '') })] });
        else if (field.kind === 'repeater') {
            const rows = Array.isArray(value) ? value : [];
            content = _jsxs("fieldset", { disabled: off, children: [_jsx("legend", { children: field.label }), rows.map((row, index) => _jsxs("fieldset", { children: [_jsxs("legend", { children: [field.label, " ", index + 1] }), field.children?.map(f => render(f, { values: row, prefix: `${field.id}.${index}.`, change: (key, next) => update(rows.map((r, i) => i === index ? { ...r, [key]: next } : r)) })), _jsxs("button", { type: "button", disabled: off || rows.length <= (field.min || 0), onClick: () => update(rows.filter((_, i) => i !== index)), children: ["Remove item ", index + 1] })] }, index)), _jsxs("button", { type: "button", disabled: off || rows.length >= (field.max ?? 50), onClick: () => update([...rows, {}]), children: ["Add ", field.label] })] });
        }
        else
            content = _jsxs(_Fragment, { children: [title, Input ? _jsx(Input, { field: field, value: value, onChange: update, id: id, disabled: off, invalid: issues.length > 0, describedBy: `${id}-help ${id}-errors`, onUpload: onUpload }) : _jsx("p", { role: "alert", children: "This field type is unavailable." })] });
        return _jsxs("div", { className: `forms-field forms-style-${state.style || 'normal'}`, style: { ...widthStyle(field.layout?.kind === 'columns' && field.layout.width === 'full' ? 1 : widthFraction(field)), gridColumn: `span ${field.layout?.kind === 'columns' && field.layout.width === 'full' ? 12 : field.width || 12}` }, children: [content, field.help && field.kind !== 'content' && _jsx("small", { id: `${id}-help`, children: field.help }), _jsx("div", { id: `${id}-errors`, children: issues.map((error, i) => _jsx("p", { className: "forms-error", children: error.message }, i)) })] }, field.id);
    };
    const theme = definition.theme;
    return _jsxs("div", { ref: root, className: `forms-runtime forms-size-${theme.size}`, lang: definition.locale, dir: definition.direction, style: { '--forms-primary': theme.primary, '--forms-background': theme.background, '--forms-text': theme.text, '--forms-border': theme.border, '--forms-error': theme.error, '--forms-radius': `${theme.radius}px`, '--forms-spacing': `${theme.spacing}px`, fontFamily: theme.font }, children: [errors.length > 0 && _jsxs("div", { ref: summary, tabIndex: -1, role: "alert", className: "forms-error-summary", children: [_jsx("h3", { children: "Please check your answers" }), errors.map((error, i) => _jsx("p", { children: _jsx("button", { type: "button", onClick: () => { const index = groups.findIndex(g => flattenFields(g.fields).some(f => f.id === error.field)); if (index >= 0)
                                navigate(index); requestAnimationFrame(() => document.getElementById(`${uid}-${error.path}`)?.focus()); }, children: error.message }) }, i))] }), definition.access.analytics && definition.access.analyticsConsent && !preview && _jsxs("label", { className: "forms-check", children: [_jsx("input", { type: "checkbox", checked: consent, onChange: e => setConsent(e.target.checked) }), "Allow anonymous form usage measurements. Answers are not included."] }), definition.mode !== 'standard' && _jsxs(_Fragment, { children: [_jsx("p", { "aria-live": "polite", children: review ? 'Review your answers' : `Step ${current + 1} of ${groups.length}` }), _jsx("progress", { max: groups.length, value: review ? groups.length : current + 1, "aria-label": "Form progress" }), _jsx("h2", { className: "forms-step-heading", tabIndex: -1, children: review ? 'Review' : group?.label })] }), review ? reviewAnswers : _jsx("div", { className: "forms-grid", children: (definition.mode === 'standard' ? active : group?.fields || []).map(f => render(f)) }), _jsxs("div", { className: "forms-actions", hidden: hideActions, children: [definition.mode !== 'standard' && (current > 0 || review) && _jsx("button", { type: "button", disabled: busy, onClick: () => review ? setReview(false) : navigate(current - 1), children: "Back" }), definition.access.saveProgress && onSave && _jsx("button", { type: "button", disabled: busy || disabled, onClick: async () => { setBusy(true); try {
                            setMessage((await onSave(raw)).message);
                        }
                        catch (error) {
                            setMessage(error.message);
                        }
                        finally {
                            setBusy(false);
                        } }, children: "Save progress" }), definition.mode !== 'standard' && !review ? _jsx("button", { type: "button", className: "forms-primary", disabled: disabled || busy, onClick: next, children: "Continue" }) : _jsx("button", { type: "button", className: "forms-primary", disabled: disabled || busy, onClick: submit, children: busy ? 'Working…' : theme.buttonLabel })] }), _jsx("p", { role: "status", children: message }), showLogic && _jsxs("aside", { className: "forms-logic", children: [_jsx("h3", { children: "Logic inspector" }), _jsx("p", { children: evaluation.matchedRules.length ? 'Matched rules:' : 'No rules matched.' }), _jsx("ul", { children: definition.rules.map(rule => _jsxs("li", { children: [evaluation.matchedRules.includes(rule.id) ? 'Matched' : 'Not matched', ": ", rule.name] }, rule.id)) }), _jsx("p", { children: evaluation.issues.map(issue => issue.message).join(' ') })] })] });
}
