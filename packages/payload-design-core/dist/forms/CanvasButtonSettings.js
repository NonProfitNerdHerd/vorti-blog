'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { canvasButtons } from './graph.js';
import { makeID } from './model.js';
export function CanvasButtonSettings({ field, definition, onChange }) {
    const buttons = canvasButtons(definition, field.id);
    return _jsxs("fieldset", { children: [_jsx("legend", { children: "Canvas buttons" }), _jsx("p", { children: "These buttons are used when graph navigation is enabled in Logic." }), buttons.map(button => _jsxs("div", { children: [_jsxs("label", { children: ["Button label", _jsx("input", { value: button.label, onChange: e => onChange(buttons.map(b => b.id === button.id ? { ...b, label: e.target.value } : b)) })] }), _jsxs("label", { children: ["Button event", _jsx("select", { value: button.event, onChange: e => onChange(buttons.map(b => b.id === button.id ? { ...b, event: e.target.value } : b)), children: ['next', 'back', 'submit', 'custom'].map(event => _jsx("option", { children: event }, event)) })] }), _jsx("button", { type: "button", onClick: () => onChange(buttons.filter(b => b.id !== button.id)), children: "Remove button" })] }, button.id)), _jsx("button", { type: "button", onClick: () => onChange([...buttons, { id: makeID('button'), label: 'New button', event: 'custom' }]), children: "Add button" })] });
}
