import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { contactComponents } from './contact.js';
import { WidthControl } from './WidthControl.js';
export function ContactSettings({ field, update }) {
    if (!['name', 'phone', 'address'].includes(field.kind))
        return null;
    const options = field.kind === 'name' ? [['full', 'Full name'], ['firstLast', 'First and Last'], ['middleInitial', 'First, Middle Initial, and Last'], ['middle', 'First, Middle, and Last']] : [['us', 'US'], ['international', 'International']];
    return _jsxs("section", { children: [_jsxs("label", { children: [field.kind === 'name' ? 'Name layout' : field.kind === 'phone' ? 'Phone format' : 'Address format', _jsxs("select", { "aria-label": field.kind === 'name' ? 'Name layout' : field.kind === 'phone' ? 'Phone format' : 'Address format', value: field.contact?.format || '', onChange: event => update({ contact: { ...field.contact, format: event.target.value } }), children: [_jsx("option", { value: "", disabled: true, children: "Existing format (unchanged)" }), options.map(([value, label]) => _jsx("option", { value: value, children: label }, value))] })] }), field.kind === 'address' && field.contact?.format === 'us' && _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: field.contact.line2 || false, onChange: event => update({ contact: { ...field.contact, line2: event.target.checked } }) }), "Show Address Line 2"] }), _jsx("p", { children: "Select an input in Build or expand this part in List View to adjust its label and width. Existing answers are never rewritten." })] });
}
export function ComponentSettings({ field, component, update, disabled }) {
    const part = contactComponents(field).find(item => item.key === component);
    if (!part)
        return _jsx("p", { children: "This component is not used by the selected format." });
    const apply = (patch) => update({ components: { ...field.components, [component]: { ...field.components?.[component], ...patch } } });
    return _jsxs("fieldset", { disabled: disabled, children: [_jsx("legend", { children: part.label }), _jsxs("p", { children: ["This input belongs to ", field.blockLabel || field.label, ". Its answer key stays ", component, "."] }), _jsxs("label", { children: ["Input label", _jsx("input", { value: part.label, onChange: event => apply({ label: event.target.value }) })] }), _jsx(WidthControl, { value: part.widthFraction, onChange: widthFraction => apply({ widthFraction }), disabled: disabled }), _jsxs("label", { children: ["Help text", _jsx("textarea", { value: part.help || '', onChange: event => apply({ help: event.target.value }) })] }), _jsxs("label", { children: ["Placeholder", _jsx("input", { value: part.placeholder || '', onChange: event => apply({ placeholder: event.target.value }) })] }), _jsx("button", { type: "button", onClick: () => { const components = { ...field.components }; delete components[component]; update({ components }); }, children: "Reset input presentation" })] });
}
