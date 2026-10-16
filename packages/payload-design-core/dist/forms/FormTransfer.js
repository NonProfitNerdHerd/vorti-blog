'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { exportForm, importForm } from './transfer.js';
export function FormTransfer({ value, onImport, readOnly, expanded = false }) {
    const [candidate, setCandidate] = useState();
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const file = useRef(null);
    const result = useRef(null);
    const request = useRef(0);
    const report = () => requestAnimationFrame(() => result.current?.focus());
    async function load(selected) {
        const sequence = ++request.current;
        setBusy(true);
        setError('');
        setCandidate(undefined);
        setMessage('');
        try {
            if (selected.size > 1000000)
                throw new Error('Choose a JSON file smaller than 1 MB.');
            const imported = importForm(JSON.parse(await selected.text()));
            if (sequence === request.current) {
                setCandidate(imported);
                report();
            }
        }
        catch (cause) {
            if (sequence === request.current) {
                setError(cause instanceof SyntaxError ? 'This file is not valid JSON. Choose a Vorti form export.' : cause instanceof Error ? cause.message : 'The form could not be imported.');
                report();
            }
        }
        finally {
            if (sequence === request.current)
                setBusy(false);
        }
    }
    function download() {
        const url = URL.createObjectURL(new Blob([JSON.stringify(exportForm('Reusable form', value), null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'form-definition.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage('Definition exported. No submitted answers or private integration settings are included.');
    }
    const content = _jsxs(_Fragment, { children: [_jsx("p", { children: "Move a versioned form definition between sites. Exports exclude submissions, actions, payment settings, private defaults, profile prefilling, collection connections, and allowed origins. Reconfigure these after importing." }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", onClick: download, children: "Export definition" }), _jsxs("label", { children: ["Import JSON file", _jsx("input", { ref: file, type: "file", accept: "application/json,.json", disabled: readOnly || busy, onChange: event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected)
                                    void load(selected); } })] })] }), _jsxs("div", { ref: result, tabIndex: -1, "aria-label": "Import result", "aria-live": "polite", children: [busy && _jsx("p", { children: "Checking the file\u2026" }), error && _jsx("p", { role: "alert", children: error }), candidate && _jsxs(_Fragment, { children: [_jsxs("h3", { children: ["Import \u201C", candidate.title, "\u201D?"] }), _jsx("p", { children: "This replaces the working form definition. Existing entries and the published revision stay unchanged until you publish. The document title is unchanged. Imported fields and rules receive fresh IDs. You can undo this change." }), _jsxs("div", { className: "forms-builder-actions", children: [_jsx("button", { type: "button", onClick: () => { setCandidate(undefined); file.current?.focus(); }, children: "Cancel import" }), _jsx("button", { type: "button", disabled: readOnly, onClick: () => { onImport(candidate.definition); setCandidate(undefined); setMessage('Imported into the working draft. Review configuration, then save the form.'); file.current?.focus(); }, children: "Replace working definition" })] })] }), message && _jsx("p", { role: "status", children: message })] })] });
    return expanded ? _jsxs("section", { className: "forms-builder-panel", "aria-label": "Import / Export", children: [_jsx("h2", { children: "Import / Export form definition" }), content] }) : _jsxs("details", { className: "forms-builder-panel", children: [_jsx("summary", { children: "Import / export form definition" }), content] });
}
