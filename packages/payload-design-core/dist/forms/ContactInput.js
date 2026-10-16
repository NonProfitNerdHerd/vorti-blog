'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { contactComponents, usStates, widthStyle } from './contact.js';
import { ResizeHandle } from './WidthControl.js';
export function ContactInput({ field, value, onChange, id, disabled, build, selectedComponent, selectComponent, resizeComponent }) {
    const parts = contactComponents(field);
    let values = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val ?? '')])) : {};
    if (field.kind === 'phone') {
        const text = typeof value === 'string' ? value : '';
        if (field.contact?.format === 'us') {
            const segments = text.startsWith('+1 ') ? text.slice(3).split(' ') : undefined;
            const digits = text.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
            values = { code: '1', area: segments?.[0] ?? digits.slice(0, 3), prefix: segments?.[1] ?? digits.slice(3, 6), line: segments?.[2] ?? digits.slice(6, 10) };
        }
        else {
            const [code, ...rest] = text.replace(/^\+/, '').split(' ');
            values = { code: text ? code : '1', national: rest.join('').replace(/\D/g, '') };
        }
    }
    const change = (key, next) => {
        const updated = { ...values, [key]: next };
        if (field.kind === 'phone' && !(field.contact?.format === 'us' ? updated.area || updated.prefix || updated.line : updated.national))
            onChange('');
        else if (field.kind === 'phone')
            onChange(field.contact?.format === 'us' ? `+1 ${updated.area || ''} ${updated.prefix || ''} ${updated.line || ''}` : `+${updated.code || ''} ${updated.national || ''}`);
        else
            onChange({ ...updated, ...(field.kind === 'address' && field.contact?.format === 'us' ? { country: 'US' } : {}) });
    };
    const legacy = !field.contact && !field.components;
    return _jsx("div", { className: legacy ? 'forms-columns forms-compound' : 'forms-compound forms-fraction-row', children: parts.map((part, index) => _jsxs("div", { "data-width-part": true, "data-component": part.key, className: `forms-subfield ${build && selectedComponent === part.key ? 'is-selected' : ''}`, style: widthStyle(part.widthFraction), role: build ? 'button' : undefined, tabIndex: build ? 0 : undefined, "aria-label": build ? `Select ${part.label}` : undefined, onClick: build ? event => { event.stopPropagation(); selectComponent?.(part.key); } : undefined, onKeyDown: build ? event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                selectComponent?.(part.key);
            } } : undefined, children: [_jsxs("label", { children: [part.label, field.kind === 'address' && field.contact?.format === 'us' && part.key === 'region' ? _jsxs("select", { "aria-label": part.label, id: index === 0 ? id : `${id}-${part.key}`, disabled: disabled || build, autoComplete: part.autocomplete, value: values[part.key] || '', onChange: event => change(part.key, event.target.value), children: [_jsx("option", { value: "", children: "Choose state" }), usStates.map(state => _jsx("option", { children: state }, state))] }) : _jsx("input", { id: index === 0 ? id : `${id}-${part.key}`, disabled: disabled || build, readOnly: field.kind === 'phone' && field.contact?.format === 'us' && part.key === 'code', type: field.kind === 'phone' ? 'tel' : 'text', inputMode: field.kind === 'phone' || (field.contact?.format === 'us' && part.key === 'postalCode') ? 'numeric' : 'text', autoComplete: part.autocomplete, placeholder: part.placeholder, value: values[part.key] || '', maxLength: field.kind === 'phone' ? part.key === 'code' || part.key === 'area' || part.key === 'prefix' ? 3 : part.key === 'line' ? 4 : 14 : undefined, onPaste: event => { if (field.kind === 'phone' && field.contact?.format === 'us') {
                                const digits = event.clipboardData.getData('text').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
                                if (digits.length === 10) {
                                    event.preventDefault();
                                    onChange('+1' + digits);
                                }
                            } }, onChange: event => change(part.key, field.kind === 'phone' ? event.target.value.replace(/\D/g, '') : event.target.value) })] }), part.help && _jsx("small", { children: part.help }), build && selectedComponent === part.key && resizeComponent && _jsx(ResizeHandle, { label: part.label, value: part.widthFraction, onChange: width => resizeComponent(part.key, width) })] }, part.key)) });
}
