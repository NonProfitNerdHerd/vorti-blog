'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { DeviceControl, DimensionControl, IconButton, InspectorIcon, Popover, } from './InspectorControls.js';
import { styleOptions } from '../blocks/style-schema.js';
export function PaintControl({ label, value, update, gradient = false, }) {
    const [draft, setDraft] = useState(value), [previous, setPrevious] = useState(value);
    if (previous !== value) {
        setPrevious(value);
        setDraft(value);
    }
    const colors = value.match(/#[\da-f]{6,8}/gi) ?? ['#ffffff', '#333333'];
    const angle = /^linear-gradient\((\d+)deg/.exec(value)?.[1] ?? '90';
    const changeStop = (index, color) => {
        const next = [...colors];
        next[index] = color;
        update(`linear-gradient(${angle}deg, ${next.join(', ')})`);
    };
    return (_jsxs(Popover, { label: label, trigger: _jsxs("span", { className: "inspector-swatch", children: [_jsx("span", { style: { background: value || 'transparent' } }), value ? label : `${label}: none`] }), children: [gradient ? (_jsxs(_Fragment, { children: [colors.map((color, i) => (_jsxs("label", { children: ["Stop ", i + 1, _jsx("input", { type: "color", "aria-label": `${label} stop ${i + 1}`, value: color.slice(0, 7), onChange: (e) => changeStop(i, e.target.value) }), _jsx("button", { type: "button", disabled: colors.length <= 2, onClick: () => update(`linear-gradient(${angle}deg, ${colors.filter((_, j) => j !== i).join(', ')})`), children: "Remove stop" })] }, i))), _jsx("button", { type: "button", disabled: colors.length >= 8, onClick: () => update(`linear-gradient(${angle}deg, ${[...colors, '#ffffff'].join(', ')})`), children: "Add stop" }), _jsxs("label", { children: ["Angle", _jsx("input", { type: "range", min: "0", max: "360", "aria-label": `${label} angle`, value: angle, onChange: (e) => update(`linear-gradient(${e.target.value}deg, ${colors.join(', ')})`) })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Color", _jsx("input", { type: "color", "aria-label": `${label} picker`, value: /^#[\da-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000', onChange: (e) => update(e.target.value + (value.length === 9 ? value.slice(7) : '')) })] }), _jsxs("label", { children: ["Opacity", _jsx("input", { type: "range", min: "0", max: "100", "aria-label": `${label} opacity`, value: value.length === 9 ? Math.round((parseInt(value.slice(7), 16) / 255) * 100) : 100, onChange: (e) => update((/^#[\da-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000') +
                                    Math.round(Number(e.target.value) * 2.55)
                                        .toString(16)
                                        .padStart(2, '0')) })] })] })), _jsxs("label", { children: ["Value", _jsx("input", { "aria-label": `${label} value`, value: draft, onChange: (e) => {
                            setDraft(e.target.value);
                            update(e.target.value);
                        }, onBlur: () => setDraft(value) })] }), _jsxs("button", { type: "button", onClick: () => update(''), children: ["Reset ", label] })] }));
}
export const expandSides = (value) => {
    const p = value.trim().split(/\s+/);
    return [p[0] || '', p[1] ?? p[0] ?? '', p[2] ?? p[0] ?? '', p[3] ?? p[1] ?? p[0] ?? ''];
};
function ShadowControl({ value, update }) {
    const match = /^(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px(?: ([\d.]+)px)? (#[\da-f]{3,8})$/i.exec(value);
    const parts = [match?.[1] ?? '0', match?.[2] ?? '4', match?.[3] ?? '12', match?.[4] ?? '0'];
    const color = match?.[5] ?? '#00000033';
    const change = (index, next) => {
        const result = [...parts];
        result[index] = next.replace(/px$/, '') || '0';
        update(`${result.map((v) => v + 'px').join(' ')} ${color}`);
    };
    return (_jsxs(Popover, { label: "Shadow", trigger: value || 'Add shadow', children: [['Horizontal offset', 'Vertical offset', 'Blur', 'Spread'].map((label, i) => (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx(DimensionControl, { label: `Shadow ${label.toLowerCase()}`, value: parts[i] + 'px', units: ['px'], negative: i < 2, update: (v) => change(i, v) })] }, label))), _jsx(PaintControl, { label: "Shadow color", value: color, update: (v) => update(`${parts.map((p) => p + 'px').join(' ')} ${v || '#00000000'}`) }), _jsx("button", { type: "button", onClick: () => update(''), children: "Reset shadow" })] }));
}
export function FocalPoint({ url, value, update, }) {
    const [x, y] = value.split(/\s+/).map((v) => parseFloat(v));
    const horizontal = Number.isFinite(x) ? x : 50, vertical = Number.isFinite(y) ? y : 50;
    return (_jsxs("div", { children: [_jsx("button", { type: "button", className: "inspector-focal", "aria-label": "Image focal point", style: { backgroundImage: url ? `url("${url}")` : undefined }, onPointerDown: (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    update(`${Math.round(((e.clientX - r.left) / r.width) * 100)}% ${Math.round(((e.clientY - r.top) / r.height) * 100)}%`);
                }, children: _jsx("span", { style: { left: `${horizontal}%`, top: `${vertical}%` }, children: "+" }) }), _jsxs("label", { children: ["Horizontal focal point", _jsx("input", { type: "range", min: "0", max: "100", value: horizontal, onChange: (e) => update(`${e.target.value}% ${vertical}%`) })] }), _jsxs("label", { children: ["Vertical focal point", _jsx("input", { type: "range", min: "0", max: "100", value: vertical, onChange: (e) => update(`${horizontal}% ${e.target.value}%`) })] })] }));
}
export function VisualStyleControl({ name, value, inherited, update, values, updateMany, inheritedValues, responsive = true, state, setState, }) {
    const vertical = name === 'alignItems'
        ? !String(inheritedValues.flexDirection).startsWith('column')
        : name === 'justifyContent' && String(inheritedValues.flexDirection).startsWith('column');
    const label = name === 'alignItems' || name === 'justifyContent'
        ? `Content ${vertical ? 'vertical' : 'horizontal'} ${name === 'justifyContent' ? 'justification' : 'alignment'}`
        : name.replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
    const [individual, setIndividual] = useState(value.trim().split(/\s+/).length > 1 ||
        ['Top', 'Right', 'Bottom', 'Left'].some((side) => values[name + side] !== undefined));
    const effective = value || inherited || '';
    const dimension = /^(width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|letterSpacing|gap|borderWidth|borderRadius|top|right|bottom|left)$/.test(name);
    return (_jsxs("div", { className: "inspector-property", "data-inherited": !value, children: [_jsxs("div", { className: "inspector-property-heading", children: [_jsx("span", { children: label }), responsive && _jsx(DeviceControl, { label: label }), setState && (_jsx(Popover, { label: `${label} state`, trigger: state === 'normal' ? '○' : state === 'hover' ? '↗' : '◎', children: _jsx("div", { className: "inspector-segments", children: ['normal', 'hover', 'focus'].map((v) => (_jsx("button", { type: "button", "aria-pressed": state === v, onClick: () => setState(v), children: v }, v))) }) })), _jsx(IconButton, { label: `Reset ${label}`, icon: "reset", onClick: () => name === 'padding' || name === 'margin'
                            ? updateMany(Object.fromEntries([name, ...['Top', 'Right', 'Bottom', 'Left'].map((s) => name + s)].map((k) => [
                                k,
                                '',
                            ])))
                            : update('') })] }), !value &&
                inherited &&
                !['Top', 'Right', 'Bottom', 'Left'].some((side) => values[name + side] !== undefined) && (_jsxs("small", { className: "inspector-inherited", children: ["Inherited: ", inherited] })), name === 'padding' || name === 'margin' ? (_jsxs(_Fragment, { children: [_jsx(IconButton, { label: individual ? `Link ${label} sides` : `Unlink ${label} sides`, icon: individual ? 'unlinked' : 'linked', pressed: !individual, onClick: () => {
                            if (individual) {
                                updateMany(Object.fromEntries([
                                    [
                                        name,
                                        values[name + 'Top'] ??
                                            inheritedValues[name + 'Top'] ??
                                            expandSides(effective)[0],
                                    ],
                                    ...['Top', 'Right', 'Bottom', 'Left'].map((side) => [name + side, '']),
                                ]));
                            }
                            setIndividual(!individual);
                        } }), individual ? (['Top', 'Right', 'Bottom', 'Left'].map((side, i) => (_jsxs("div", { className: "inspector-side", "data-inherited": values[name + side] === undefined && !value, title: values[name + side] === undefined && !value
                            ? `${side}: inherited`
                            : `${side}: override`, children: [_jsx("span", { title: side, children: _jsx(InspectorIcon, { name: side.toLowerCase() }) }), _jsx(DimensionControl, { label: `${label} ${side.toLowerCase()}`, value: values[name + side] ?? inheritedValues[name + side] ?? expandSides(effective)[i], negative: name === 'margin', update: (v) => updateMany({ [name + side]: v }) }), _jsx(IconButton, { label: `Reset ${label} ${side.toLowerCase()}`, icon: "reset", onClick: () => {
                                    const patch = { [name + side]: '' };
                                    if (values[name]) {
                                        const sides = expandSides(values[name]);
                                        patch[name] = '';
                                        ['Top', 'Right', 'Bottom', 'Left'].forEach((s, j) => {
                                            if (s !== side)
                                                patch[name + s] = values[name + s] ?? sides[j];
                                        });
                                    }
                                    updateMany(patch);
                                } })] }, side)))) : (_jsx(DimensionControl, { label: label, value: effective, negative: name === 'margin', update: (v) => updateMany(Object.fromEntries([
                            [name, v],
                            ...['Top', 'Right', 'Bottom', 'Left'].map((s) => [name + s, '']),
                        ])) }))] })) : /Color$|^color$/.test(name) ? (_jsx(PaintControl, { label: label, value: effective, update: update })) : name === 'backgroundImage' ? (_jsx(PaintControl, { label: "Gradient", value: effective, update: update, gradient: true })) : name === 'boxShadow' ? (_jsx(ShadowControl, { value: effective, update: update })) : ['textAlign', 'alignItems', 'justifyContent'].includes(name) ? (_jsx("div", { className: "inspector-segments", children: styleOptions[name].map((v, i) => (_jsx("button", { type: "button", title: `${label}: ${v}`, "aria-label": `${label}: ${v}`, "aria-pressed": effective === v, onClick: () => update(v), children: _jsx("svg", { width: "20", height: "20", viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: "2", style: { transform: vertical ? 'rotate(90deg)' : undefined }, children: _jsx("path", { d: i === 0
                                ? 'M4 4v16M7 7h12M7 12h8M7 17h12'
                                : i === 1
                                    ? 'M12 3v18M5 7h14M8 12h8M5 17h14'
                                    : i === 2
                                        ? 'M20 4v16M5 7h12M9 12h8M5 17h12'
                                        : 'M4 4v16M20 4v16M7 7h10M7 12h10M7 17h10' }) }) }, v))) })) : dimension ? (_jsx(DimensionControl, { label: label, value: effective, negative: ['top', 'right', 'bottom', 'left', 'letterSpacing'].includes(name), units: ['fontSize', 'letterSpacing', 'borderWidth', 'borderRadius', 'gap'].includes(name)
                    ? ['px', 'rem', 'em']
                    : undefined, update: update })) : styleOptions[name] ? (_jsxs("select", { "aria-label": label, value: value, onChange: (e) => update(e.target.value), children: [_jsx("option", { value: "", children: "Inherit" }), styleOptions[name].map((v) => (_jsx("option", { children: v }, v)))] })) : (_jsx("input", { "aria-label": label, value: value, placeholder: inherited || 'Inherit', onChange: (e) => update(e.target.value) }))] }));
}
