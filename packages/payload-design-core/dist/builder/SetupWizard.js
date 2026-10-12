'use client';
import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useId, useRef } from 'react';
export function SetupWizard({ steps, current, onChange, children, }) {
    const id = useId(), heading = useRef(null);
    const go = (step) => {
        onChange(step);
        requestAnimationFrame(() => heading.current?.focus());
    };
    return (_jsxs("section", { className: "pt-wizard", children: [_jsx("nav", { "aria-label": "Post Type setup steps", children: _jsx("ol", { children: steps.map((step, index) => (_jsx("li", { children: _jsxs("button", { type: "button", "aria-current": current === index ? 'step' : undefined, onClick: () => go(index), children: [index + 1, ". ", step] }) }, step))) }) }), _jsxs("div", { className: "pt-wizard-body", "aria-labelledby": id, children: [_jsxs("h2", { id: id, ref: heading, tabIndex: -1, children: ["Step ", current + 1, ": ", steps[current]] }), children, _jsxs("div", { className: "pt-wizard-actions", children: [_jsx("button", { type: "button", disabled: current === 0, onClick: () => go(current - 1), children: "Back" }), _jsxs("span", { children: [current + 1, " of ", steps.length] }), _jsx("button", { type: "button", disabled: current === steps.length - 1, onClick: () => go(current + 1), children: "Next" })] })] })] }));
}
