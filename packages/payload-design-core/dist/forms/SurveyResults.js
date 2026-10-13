'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import './forms.css';
export function SurveyResults({ endpoint }) {
    const [result, setResult] = useState();
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        fetch(endpoint, { signal: controller.signal }).then(async (response) => {
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.message || 'Could not load results.');
            if (!controller.signal.aborted)
                setResult({ endpoint, ...data });
        }).catch(error => { if (!controller.signal.aborted)
            setResult({ endpoint, error: error.message }); });
        return () => controller.abort();
    }, [endpoint, retry]);
    const current = result?.endpoint === endpoint ? result : undefined;
    return _jsxs("section", { "aria-label": "Survey results", className: "forms-survey", children: [_jsx("h3", { children: "Survey results" }), _jsx("p", { children: "Sensitive fields and free-text answers are excluded. Repeated fields count individual items, not people. Percentages use answered responses; multiple choices may exceed 100%." }), !current ? _jsx("p", { role: "status", children: "Loading results\u2026" }) : current.error ? _jsxs("p", { role: "alert", children: [current.error, " ", _jsx("button", { type: "button", onClick: () => setRetry(n => n + 1), children: "Retry results" })] }) : _jsxs(_Fragment, { children: [current.message && _jsx("p", { role: "status", children: current.message }), current.entries !== undefined && _jsxs("p", { children: [current.entries, " entries in this revision and date range."] }), !current.message && !current.fields?.length && _jsx("p", { children: "No supported survey fields have reportable responses." }), current.fields?.map(field => _jsxs("section", { children: [_jsxs("h4", { children: [field.label, field.repeated ? ' (repeated items)' : ''] }), _jsxs("p", { children: [field.responses, " answers", field.mean !== undefined ? ` · Mean ${field.mean.toFixed(2)}` : '', field.nps !== undefined ? ` · NPS ${field.nps.toFixed(1)}` : ''] }), (field.rows || [{ id: field.id, label: field.label, responses: field.responses, buckets: field.buckets }]).map(row => _jsxs("table", { children: [_jsx("caption", { children: row.label }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Answer" }), _jsx("th", { scope: "col", children: "Count" }), _jsx("th", { scope: "col", children: "Percent" }), field.kind === 'ranking' && _jsx("th", { scope: "col", children: "Mean rank (1 is first)" })] }) }), _jsx("tbody", { children: row.buckets.map(bucket => _jsxs("tr", { children: [_jsx("th", { scope: "row", children: bucket.label }), _jsx("td", { children: bucket.count }), _jsxs("td", { children: [row.responses ? (100 * bucket.count / row.responses).toFixed(1) : '0', "%"] }), field.kind === 'ranking' && _jsx("td", { children: bucket.count ? ((bucket.rankTotal || 0) / bucket.count).toFixed(2) : '—' })] }, bucket.id)) })] }, row.id))] }, field.id))] })] });
}
