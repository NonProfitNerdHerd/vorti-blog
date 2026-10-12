'use client';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { applyVariation, variationsFor } from '../blocks/variations.js';
import './variations-editor.css';
import { beginInspectorGesture, endInspectorGesture } from './InspectorControls.js';
export function VariationPicker({ node, onChange, onDone, initial = false, disabled = false, }) {
    const variations = variationsFor(node.kind);
    if (!variations.length)
        return null;
    const choose = (id) => {
        beginInspectorGesture();
        try {
            onChange(applyVariation(node, id));
        }
        finally {
            endInspectorGesture();
        }
        onDone?.();
    };
    return (_jsxs("div", { className: "block-variation-picker", onClick: (e) => e.stopPropagation(), children: [_jsx("p", { children: initial ? 'Select a variation to start with' : 'Layout variations' }), _jsx("div", { role: "group", "aria-label": `${node.label ?? node.kind} variations`, children: variations.map((variation, index) => (_jsxs("button", { type: "button", disabled: disabled, "aria-pressed": node.variation?.id === variation.id, onClick: () => choose(variation.id), onKeyDown: (e) => {
                        const next = e.key === 'ArrowRight'
                            ? index + 1
                            : e.key === 'ArrowLeft'
                                ? index - 1
                                : e.key === 'Home'
                                    ? 0
                                    : e.key === 'End'
                                        ? variations.length - 1
                                        : -1;
                        if (next >= 0) {
                            e.preventDefault();
                            const buttons = e.currentTarget.parentElement?.querySelectorAll('button');
                            buttons?.[next % variations.length]?.focus();
                        }
                    }, children: [_jsxs("svg", { width: "64", height: "44", viewBox: "0 0 64 44", "aria-hidden": "true", children: [_jsx("rect", { x: "2", y: "2", width: "60", height: "40", rx: "2", fill: "none", stroke: "currentColor" }), variation.thumbnail === 'split' ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "5", y: "5", width: "25", height: "34", fill: "currentColor", opacity: ".25" }), _jsx("path", { d: "M35 12h20M35 18h17M35 27h12", stroke: "currentColor" })] })) : variation.thumbnail === 'overlay' ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "5", y: "5", width: "54", height: "34", fill: "currentColor", opacity: ".25" }), _jsx("rect", { x: index % 2 ? 20 : 10, y: "14", width: "32", height: "19", fill: "var(--theme-bg,#fff)" }), _jsx("path", { d: "M24 19h13M24 25h10", stroke: "currentColor" })] })) : variation.thumbnail === 'grid' ? (_jsx(_Fragment, { children: [8, 25, 42].map((x) => (_jsx("rect", { x: x, y: index % 2 ? 10 + (x % 3) * 3 : 10, width: "13", height: "25", fill: "currentColor", opacity: ".4" }, x))) })) : (_jsxs(_Fragment, { children: [_jsx("rect", { x: "8", y: "6", width: "48", height: "15", fill: "currentColor", opacity: ".25" }), _jsx("path", { d: "M10 27h42M10 33h30", stroke: "currentColor" })] }))] }), _jsx("span", { children: variation.label })] }, variation.id))) }), initial && (_jsx("button", { type: "button", disabled: disabled, onClick: () => choose(variations[0].id), children: "Skip" }))] }));
}
