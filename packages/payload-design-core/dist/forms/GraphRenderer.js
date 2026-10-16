'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormRenderer } from './FormRenderer.js';
import { canvasButtons, graphScope, graphAnswers, runGraph } from './graph.js';
import { evaluateForm, validateAnswers } from './engine.js';
import { flattenFields } from './model.js';
export function GraphRenderer(props) {
    const { definition, preview, disabled, onGraphRun } = props;
    const [answers, setAnswers] = useState(() => evaluateForm({ ...definition, graph: undefined }, props.initialAnswers || {}).answers);
    const [events, setEvents] = useState([]), [errors, setErrors] = useState([]);
    const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [notice, setNotice] = useState('');
    const submitted = useRef(false), heading = useRef(null);
    const run = useMemo(() => runGraph(definition, answers, events, true), [definition, answers, events]);
    const node = run.node, canvas = definition.fields.find(f => f.id === node?.canvas);
    useEffect(() => { onGraphRun?.(run); }, [run, onGraphRun]);
    useEffect(() => { heading.current?.focus(); }, [node?.id]);
    const advance = (output) => { if (node) {
        setErrors([]);
        setEvents(old => [...old, { node: node.id, output }]);
    } };
    const back = () => {
        if (accepted)
            return;
        let index = events.length - 1;
        while (index >= 0 && definition.graph?.nodes.find(n => n.id === events[index].node)?.kind !== 'canvas')
            index--;
        if (index >= 0) {
            setEvents(events.slice(0, index));
            setErrors([]);
            setNotice('');
        }
    };
    const validate = (currentOnly) => {
        const scoped = graphScope(definition, run);
        const result = validateAnswers(scoped, graphAnswers(definition, scoped, run.answers));
        if (currentOnly) {
            const ids = new Set(flattenFields(canvas ? [canvas] : []).map(f => f.id));
            result.issues = result.issues.filter(issue => ids.has(issue.field || ''));
        }
        setErrors(result.issues);
        return result;
    };
    const submit = async () => {
        if (submitted.current || busy)
            return;
        const result = validate(false);
        if (result.issues.length)
            return;
        submitted.current = true;
        setBusy(true);
        try {
            const response = preview ? { message: 'Preview submission validated. Nothing was saved.' } : props.onSubmit ? await props.onSubmit(run.answers, events) : { errors: [{ path: 'submit', message: 'Submission is not configured.' }] };
            if (response.errors?.length) {
                setErrors(response.errors);
                submitted.current = false;
                if (definition.graph?.edges.some(e => e.source === node?.id && e.output === 'failure'))
                    advance('failure');
            }
            else {
                setAccepted(true);
                setNotice(response.message || 'Entry accepted.');
                advance('success');
                if (!definition.graph?.edges.some(e => e.source === node?.id && e.output === 'success') && response.redirect?.startsWith('/') && !response.redirect.startsWith('//'))
                    window.location.assign(response.redirect);
            }
        }
        catch (e) {
            submitted.current = false;
            setNotice(e.message);
            if (definition.graph?.edges.some(edge => edge.source === node?.id && edge.output === 'failure'))
                advance('failure');
        }
        finally {
            setBusy(false);
        }
    };
    // Entering Submit is an explicit consequence of a connected user button, never a render-time side effect.
    useEffect(() => { if (node?.kind === 'submit' && events.length && !run.error && !submitted.current && !errors.length)
        void submit(); }, [node?.id, events.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const currentDefinition = { ...graphScope(definition, run), access: { ...definition.access, saveProgress: false } };
    const names = new Map(flattenFields(definition.fields).map(f => [f.id, f.label]));
    return _jsxs("section", { className: "forms-graph-runtime", "aria-label": "Connected form", children: [_jsx("h2", { ref: heading, tabIndex: -1, children: canvas?.label || node?.name || 'Form flow' }), run.error && _jsx("p", { role: "alert", children: run.error }), errors.length > 0 && _jsxs("div", { role: "alert", children: [_jsx("h3", { children: "Please check your answers" }), errors.map((e, i) => _jsxs("p", { children: [names.get(e.field || ''), ": ", e.message] }, i))] }), node?.kind === 'canvas' && _jsx(FormRenderer, { ...props, definition: currentDefinition, initialAnswers: run.answers, renderFieldIDs: canvas ? [canvas.id] : [], hideActions: true, onGraphRun: undefined, onChange: next => { const merged = { ...answers, ...next }; setAnswers(merged); props.onChange?.(merged); setErrors([]); } }, `${node.id}:${events.length}`), node?.kind === 'canvas' && _jsx("div", { className: "forms-actions", children: canvasButtons(definition, canvas?.id).map(button => _jsx("button", { type: "button", disabled: disabled || busy || !!run.error || button.event === 'back' && (accepted || !events.some(e => definition.graph?.nodes.find(n => n.id === e.node)?.kind === 'canvas')), onClick: () => { if (button.event === 'back')
                        back();
                    else if (!validate(true).issues.length)
                        advance(button.id); }, children: button.label }, button.id)) }), node?.kind === 'message' && _jsxs(_Fragment, { children: [_jsx("p", { children: node.message }), _jsx("button", { type: "button", disabled: disabled, onClick: () => advance('next'), children: "Continue" })] }), node?.kind === 'end' && _jsx("p", { role: "status", children: node.message }), node?.kind === 'submit' && _jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: busy || accepted || disabled, onClick: () => void submit(), children: busy ? 'Submitting…' : 'Retry submission' }), _jsx("button", { type: "button", disabled: busy || accepted, onClick: back, children: "Back" })] }), props.onSave && !accepted && _jsx("button", { type: "button", onClick: async () => { try {
                    setNotice((await props.onSave(answers)).message);
                }
                catch (e) {
                    setNotice(e.message);
                } }, children: "Save progress" }), notice && _jsx("p", { role: "status", children: notice }), run.log.some(line => line.startsWith('Simulated')) && _jsx("aside", { "aria-label": "Simulated actions", children: _jsx("p", { children: "Experimental actions are simulated. No email, CMS write, or HTTP request was performed by these blocks." }) })] });
}
