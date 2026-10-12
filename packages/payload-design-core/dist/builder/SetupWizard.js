'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useRef } from 'react';
export function SetupWizard({ steps, current, onChange, children, canAdvance = true, canVisit = () => true, issueSteps = [], }) {
    const id = useId(), heading = useRef(null);
    const go = (step) => {
        if (!canVisit(step))
            return;
        onChange(step);
        requestAnimationFrame(() => heading.current?.focus());
    };
    return (_jsxs("section", { className: "pt-wizard", children: [_jsx("nav", { "aria-label": "Post Type setup steps", children: _jsx("ol", { children: steps.map((step, index) => (_jsx("li", { children: _jsxs("button", { type: "button", "aria-label": `${index + 1}. ${step}`, "aria-current": current === index ? 'step' : undefined, disabled: !canVisit(index), title: issueSteps.includes(index) ? 'This step needs attention' : undefined, onClick: () => go(index), children: [index + 1, ". ", step, issueSteps.includes(index) && _jsx("span", { "aria-label": "Needs attention", children: " \u00B7 !" })] }) }, step))) }) }), _jsxs("div", { className: "pt-wizard-body", "aria-labelledby": id, children: [_jsxs("h2", { id: id, ref: heading, tabIndex: -1, children: ["Step ", current + 1, ": ", steps[current]] }), children, _jsxs("div", { className: "pt-wizard-actions", children: [_jsx("button", { type: "button", disabled: current === 0, onClick: () => go(current - 1), children: "Back" }), _jsxs("span", { children: [current + 1, " of ", steps.length] }), canAdvance && current < steps.length - 1 && (_jsx("button", { type: "button", disabled: current === steps.length - 1, onClick: () => go(current + 1), children: "Next" }))] })] })] }));
}
