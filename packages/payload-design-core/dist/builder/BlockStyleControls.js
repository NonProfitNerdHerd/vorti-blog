'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { resolveStyle, validStyleValue, } from '../content/model.js';
export function BlockStyleControls({ value, onChange, viewport: suppliedViewport, }) {
    const [device, setDevice] = useState('desktop');
    const viewport = suppliedViewport ?? device;
    const current = resolveStyle(value, viewport);
    const [error, setError] = useState('');
    const update = (key, next) => {
        if (next && !validStyleValue(key, next)) {
            setError(`Invalid ${key}. Use a color or a size such as 16px, 1rem, or 100%.`);
            return;
        }
        setError('');
        const styles = { ...value?.[viewport] };
        if (next)
            styles[key] = next;
        else
            delete styles[key];
        onChange({ ...value, [viewport]: styles });
    };
    return (_jsxs("div", { className: "block-style-controls", children: [!suppliedViewport && (_jsxs("label", { children: ["Style viewport", _jsx("select", { value: device, onChange: (event) => setDevice(event.target.value), children: ['desktop', 'tablet', 'mobile'].map((device) => (_jsx("option", { children: device }, device))) })] })), _jsxs("p", { children: ["Editing ", viewport, ". Empty values inherit from the larger viewport."] }), error && _jsx("p", { role: "alert", children: error }), [
                'backgroundColor',
                'color',
                'width',
                'maxWidth',
                'fontSize',
                'lineHeight',
                'borderWidth',
                'borderColor',
                'borderRadius',
                'gap',
                'minHeight',
            ].map((key) => (_jsxs("label", { children: [key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`), _jsx("input", { "aria-label": key, defaultValue: value?.[viewport]?.[key] ?? '', placeholder: current[key] ?? 'Inherit', onBlur: (event) => update(key, event.target.value.trim()) }, `${viewport}-${key}-${value?.[viewport]?.[key] ?? ''}`)] }, key))), _jsxs("label", { children: ["Text alignment", _jsxs("select", { value: value?.[viewport]?.textAlign ?? '', onChange: (event) => update('textAlign', event.target.value), children: [_jsx("option", { value: "", children: "Inherit" }), ['left', 'center', 'right'].map((option) => (_jsx("option", { children: option }, option)))] })] }), ['padding', 'margin'].map((key) => (_jsx(Spacing, { label: key, value: value?.[viewport]?.[key] ?? '', update: (value) => update(key, value) }, `${key}-${viewport}`)))] }));
}
function Spacing({ label, value, update, }) {
    const [individual, setIndividual] = useState(value.split(' ').length > 1);
    const parts = value.trim().split(/\s+/);
    const sides = [
        parts[0],
        parts[1] ?? parts[0],
        parts[2] ?? parts[0],
        parts[3] ?? parts[1] ?? parts[0],
    ];
    return (_jsxs("fieldset", { children: [_jsx("legend", { children: label }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !individual, onChange: (event) => setIndividual(!event.target.checked) }), "Linked sides"] }), individual ? (['Top', 'Right', 'Bottom', 'Left'].map((side, index) => (_jsxs("label", { children: [side, _jsx("input", { "aria-label": `${label} ${side}`, defaultValue: sides[index], onBlur: (event) => {
                            const next = sides.map((part) => part || '0');
                            next[index] = event.target.value || '0';
                            update(next.join(' '));
                        } }, `${index}-${value}`)] }, side)))) : (_jsx("input", { "aria-label": label, defaultValue: value, placeholder: "16px", onBlur: (event) => update(event.target.value) }, value))] }));
}
