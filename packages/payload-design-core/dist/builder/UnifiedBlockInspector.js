'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createContext, useContext, useState } from 'react';
import { getBlockDefinition } from '../blocks/registry.js';
import { blockIcons } from '../blocks/CatalogRenderer.js';
import { publicDocumentFields, validatePresentation, } from '../blocks/presentation.js';
import { styleOptions } from '../blocks/style-schema.js';
import { resolveStyle, validStyleValue } from '../content/model.js';
import './block-inspector.css';
const title = (key) => key
    .replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`)
    .replace(/^./, (char) => char.toUpperCase());
const InspectorTabContext = createContext(null);
export function BlockInspectorStateProvider({ children }) {
    const [tab, setTab] = useState('style');
    return (_jsx(InspectorTabContext.Provider, { value: { tab, setTab }, children: children }));
}
const sections = {
    layout: {
        'Size and spacing': [
            'width',
            'minWidth',
            'maxWidth',
            'height',
            'minHeight',
            'maxHeight',
            'aspectRatio',
            'padding',
            'margin',
        ],
        Arrangement: [
            'display',
            'flexDirection',
            'flexWrap',
            'alignItems',
            'justifyContent',
            'gap',
            'gridTemplateColumns',
        ],
    },
    style: {
        Typography: [
            'fontFamily',
            'fontSize',
            'fontWeight',
            'fontStyle',
            'lineHeight',
            'letterSpacing',
            'textAlign',
            'textTransform',
            'color',
        ],
        Background: ['backgroundColor', 'backgroundImage'],
        'Borders and shadows': [
            'borderStyle',
            'borderWidth',
            'borderColor',
            'borderRadius',
            'boxShadow',
        ],
        Image: ['objectFit', 'objectPosition'],
    },
    advanced: {
        Position: ['position', 'top', 'right', 'bottom', 'left', 'zIndex', 'opacity', 'overflow'],
        'Transform and transition': ['transform', 'transition'],
    },
};
export function UnifiedBlockInspector({ node, onChange, viewport: suppliedViewport, disabled, children, bindingFields = [], showFields = true, }) {
    const [ownTab, setOwnTab] = useState('style');
    const sharedTab = useContext(InspectorTabContext);
    const tab = sharedTab?.tab ?? ownTab, setTab = sharedTab?.setTab ?? setOwnTab;
    const [device, setDevice] = useState('desktop');
    const [state, setState] = useState('normal');
    const [error, setError] = useState('');
    const viewport = suppliedViewport ?? device;
    const definition = getBlockDefinition(node.kind);
    const presentation = node.presentation ?? {};
    const values = state === 'normal' ? (node.styles?.[viewport] ?? {}) : (presentation[state] ?? {});
    const inherited = resolveStyle(node.styles, viewport);
    const updatePresentation = (patch) => {
        const next = { ...presentation, ...patch }, problem = validatePresentation(next);
        if (problem) {
            setError(problem);
            return;
        }
        setError('');
        onChange({ presentation: next });
    };
    const update = (key, value) => {
        if (value && !validStyleValue(key, value)) {
            setError(`Invalid ${title(key)} value.`);
            return;
        }
        setError('');
        const next = { ...values };
        if (value)
            next[key] = value;
        else
            delete next[key];
        if (state === 'normal')
            onChange({ styles: { ...node.styles, [viewport]: next } });
        else
            updatePresentation({ [state]: next });
    };
    const condition = presentation.condition ?? { match: 'all', rules: [] };
    const changeRule = (index, patch) => updatePresentation({
        condition: {
            ...condition,
            rules: condition.rules.map((rule, i) => (index === i ? { ...rule, ...patch } : rule)),
        },
    });
    return (_jsxs("fieldset", { disabled: disabled, className: "unified-block-inspector", children: [_jsxs("header", { children: [_jsxs("strong", { children: [definition?.icon, " ", definition?.label ?? node.label ?? node.kind] }), _jsx("p", { children: definition?.description ?? 'Block presentation settings.' })] }), _jsx("div", { role: "tablist", "aria-label": "Block controls", children: ['layout', 'style', 'advanced'].map((name) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === name, onClick: () => setTab(name), children: title(name) }, name))) }), error && _jsx("p", { role: "alert", children: error }), _jsxs("div", { className: "block-inspector-device", children: [_jsxs("label", { children: ["Device", _jsx("select", { value: viewport, onChange: (event) => setDevice(event.target.value), disabled: !!suppliedViewport, children: ['desktop', 'tablet', 'mobile'].map((value) => (_jsx("option", { children: value }, value))) })] }), _jsxs("label", { children: ["State", _jsx("select", { value: state, onChange: (event) => setState(event.target.value), children: ['normal', 'hover', 'focus'].map((value) => (_jsx("option", { children: value }, value))) })] })] }), tab === 'style' && (_jsxs("details", { open: true, children: [_jsx("summary", { children: "Content" }), children, showFields &&
                        definition?.fields.map((field) => (_jsxs("div", { children: [_jsxs("label", { children: [field.label, field.type === 'toggle' ? (_jsx("input", { type: "checkbox", checked: Boolean(node.props?.[field.key]), onChange: (event) => onChange({ props: { ...node.props, [field.key]: event.target.checked } }) })) : field.type === 'select' || field.type === 'icon' ? (_jsx("select", { value: String(node.props?.[field.key] ?? field.defaultValue ?? ''), onChange: (event) => onChange({ props: { ...node.props, [field.key]: event.target.value } }), children: (field.type === 'icon'
                                                ? Object.keys(blockIcons)
                                                : (field.options ?? [])).map((value) => (_jsx("option", { children: value }, value))) })) : field.type === 'textarea' ? (_jsx("textarea", { value: String(node.props?.[field.key] ?? ''), onChange: (event) => onChange({ props: { ...node.props, [field.key]: event.target.value } }) })) : (_jsx("input", { type: field.type === 'number' ? 'number' : 'text', value: String(node.props?.[field.key] ?? ''), onChange: (event) => onChange({
                                                props: {
                                                    ...node.props,
                                                    [field.key]: field.type === 'number'
                                                        ? Number(event.target.value)
                                                        : event.target.value,
                                                },
                                            }) }))] }), field.bindable && (_jsxs("select", { "aria-label": `Bind ${field.label}`, value: node.bindings?.[field.key] ?? '', onChange: (event) => onChange({ bindings: { ...node.bindings, [field.key]: event.target.value } }), children: [_jsx("option", { value: "", children: "Static value" }), bindingFields.map((field) => (_jsx("option", { value: field.path, children: field.label }, field.path))), publicDocumentFields.map((key) => (_jsxs("option", { value: key, children: ["Document ", key] }, key)))] }))] }, field.key)))] })), Object.entries(sections[tab]).map(([label, keys]) => {
                const capability = label === 'Typography'
                    ? 'typography'
                    : label === 'Background'
                        ? 'background'
                        : label === 'Borders and shadows'
                            ? 'border'
                            : label === 'Image'
                                ? 'image'
                                : tab === 'advanced'
                                    ? 'advanced'
                                    : 'layout';
                if (definition && !definition.controls.includes(capability))
                    return null;
                if (label === 'Image' && node.kind !== 'image')
                    return null;
                if (label === 'Arrangement' && !definition?.container)
                    return null;
                return (_jsxs("details", { open: label === 'Size and spacing' || label === 'Typography', children: [_jsx("summary", { children: label }), keys.map((key) => (_jsx(StyleInput, { name: key, value: values[key] ?? '', inherited: inherited[key], update: (value) => update(key, value) }, `${node.id}-${viewport}-${state}-${key}`)))] }, label));
            }), tab === 'style' && (_jsxs("details", { children: [_jsx("summary", { children: "Background image and overlay" }), _jsxs("label", { children: ["Background image URL", _jsx(CommittedText, { value: presentation.background?.imageURL ?? '', onCommit: (value) => updatePresentation({ background: { ...presentation.background, imageURL: value } }) }, `${node.id}-background`)] }), _jsxs("label", { children: ["Overlay color", _jsx("input", { type: "color", value: presentation.background?.overlay ?? '#000000', onChange: (event) => updatePresentation({
                                    background: { ...presentation.background, overlay: event.target.value },
                                }) })] }), _jsxs("label", { children: ["Overlay opacity", _jsx("input", { type: "range", min: "0", max: "1", step: "0.05", value: presentation.background?.opacity ?? 0, onChange: (event) => updatePresentation({
                                    background: { ...presentation.background, opacity: Number(event.target.value) },
                                }) })] }), _jsx("button", { type: "button", onClick: () => updatePresentation({ background: undefined }), children: "Reset background image" })] })), tab === 'advanced' && (_jsxs(_Fragment, { children: [_jsxs("details", { children: [_jsx("summary", { children: "General" }), _jsxs("label", { children: ["HTML anchor", _jsx("input", { value: node.anchor ?? '', onChange: (event) => onChange({ anchor: event.target.value }) })] }), _jsxs("label", { children: ["HTML tag", _jsx("select", { value: presentation.tag ?? 'div', onChange: (event) => updatePresentation({ tag: event.target.value }), children: ['div', 'section', 'article', 'aside', 'figure'].map((value) => (_jsx("option", { children: value }, value))) })] }), _jsxs("label", { children: ["CSS classes", _jsx("input", { value: presentation.className ?? '', onChange: (event) => updatePresentation({ className: event.target.value }) })] })] }), _jsxs("details", { children: [_jsx("summary", { children: "Link" }), ['url', 'title', 'rel'].map((key) => (_jsxs("label", { children: [title(key), _jsx(CommittedText, { value: String(presentation.link?.[key] ?? ''), onCommit: (value) => updatePresentation({ link: { ...presentation.link, [key]: value } }) }, `${node.id}-${key}`)] }, key))), ['newTab', 'lightbox'].map((key) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!presentation.link?.[key], onChange: (event) => updatePresentation({
                                            link: { ...presentation.link, [key]: event.target.checked },
                                        }) }), title(key)] }, key)))] }), _jsxs("details", { children: [_jsx("summary", { children: "Responsive visibility" }), ['desktop', 'tablet', 'mobile'].map((key) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!presentation.hidden?.[key], onChange: (event) => updatePresentation({
                                            hidden: { ...presentation.hidden, [key]: event.target.checked },
                                        }) }), "Hide on ", key] }, key)))] }), _jsxs("details", { children: [_jsx("summary", { children: "Custom attributes" }), _jsxs("label", { children: ["Attributes (one name=value per line)", _jsx("textarea", { defaultValue: Object.entries(presentation.attributes ?? {})
                                            .map(([key, value]) => `${key}=${value}`)
                                            .join('\n'), onBlur: (event) => updatePresentation({
                                            attributes: Object.fromEntries(event.target.value
                                                .split('\n')
                                                .filter(Boolean)
                                                .map((line) => {
                                                const at = line.indexOf('=');
                                                return [line.slice(0, at).trim(), line.slice(at + 1)];
                                            })),
                                        }) }, `${node.id}-attributes`)] })] }), _jsxs("details", { children: [_jsx("summary", { children: "Custom CSS" }), _jsx("p", { children: "Use declarations or &-scoped rules. Example: &:hover { opacity: 0.8; }" }), _jsx(CommittedText, { multiline: true, label: "Custom CSS", value: presentation.css ?? '', onCommit: (value) => updatePresentation({ css: value }) }, `${node.id}-css`)] }), _jsxs("details", { children: [_jsx("summary", { children: "Motion effects" }), _jsxs("label", { children: ["Trigger", _jsxs("select", { value: presentation.motion?.trigger ?? '', onChange: (event) => updatePresentation({
                                            motion: event.target.value
                                                ? {
                                                    ...presentation.motion,
                                                    trigger: event.target.value,
                                                }
                                                : undefined,
                                        }), children: [_jsx("option", { value: "", children: "None" }), _jsx("option", { value: "entrance", children: "Entrance" }), _jsx("option", { value: "scroll", children: "Scroll" })] })] }), presentation.motion && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => {
                                            void import('../blocks/Motion').then((module) => module.previewBlockMotion(node.id, presentation.motion));
                                        }, children: "Preview motion" }), ['x', 'y', 'scale', 'rotate', 'skew', 'opacity', 'blur', 'duration', 'delay'].map((key) => (_jsxs("label", { children: [title(key), _jsx("input", { type: "number", step: "0.1", value: presentation.motion?.[key] ?? '', onChange: (event) => updatePresentation({
                                                    motion: { ...presentation.motion, [key]: Number(event.target.value) },
                                                }) })] }, key))), _jsxs("label", { children: ["Easing", _jsx("select", { value: presentation.motion.easing ?? 'ease-out', onChange: (event) => updatePresentation({
                                                    motion: { ...presentation.motion, easing: event.target.value },
                                                }), children: ['ease', 'linear', 'ease-in', 'ease-out'].map((value) => (_jsx("option", { children: value }, value))) })] })] }))] }), _jsxs("details", { children: [_jsx("summary", { children: "Conditional display" }), _jsxs("label", { children: ["Match", _jsxs("select", { value: condition.match, onChange: (event) => updatePresentation({
                                            condition: { ...condition, match: event.target.value },
                                        }), children: [_jsx("option", { value: "all", children: "All conditions" }), _jsx("option", { value: "any", children: "Any condition" })] })] }), condition.rules.map((rule, index) => (_jsxs("div", { children: [_jsx("select", { "aria-label": "Condition field", value: rule.field, onChange: (event) => changeRule(index, { field: event.target.value }), children: publicDocumentFields.map((key) => (_jsx("option", { children: key }, key))) }), _jsx("select", { "aria-label": "Condition operator", value: rule.operator, onChange: (event) => changeRule(index, { operator: event.target.value }), children: ['equals', 'notEquals', 'empty', 'notEmpty', 'contains'].map((key) => (_jsx("option", { children: key }, key))) }), _jsx("input", { "aria-label": "Condition value", value: rule.value ?? '', onChange: (event) => changeRule(index, { value: event.target.value }) }), _jsx("button", { type: "button", onClick: () => updatePresentation({
                                            condition: {
                                                ...condition,
                                                rules: condition.rules.filter((_, i) => i !== index),
                                            },
                                        }), children: "Remove condition" })] }, index))), _jsx("button", { type: "button", onClick: () => updatePresentation({
                                    condition: {
                                        ...condition,
                                        rules: [...condition.rules, { field: 'title', operator: 'notEmpty' }],
                                    },
                                }), children: "Add condition" }), ['start', 'end'].map((key) => (_jsxs("label", { children: [title(key), " (ISO date with timezone)", _jsx("input", { defaultValue: condition[key] ?? '', placeholder: "2026-12-01T00:00:00Z", onBlur: (event) => updatePresentation({
                                            condition: { ...condition, [key]: event.target.value || undefined },
                                        }) }, `${node.id}-${key}`)] }, key)))] })] })), definition?.inspector?.[tab]?.(node, onChange)] }));
}
function CommittedText({ value, onCommit, multiline, label, }) {
    const [draft, setDraft] = useState(value);
    const [previous, setPrevious] = useState(value);
    if (previous !== value) {
        setPrevious(value);
        setDraft(value);
    }
    return multiline ? (_jsx("textarea", { "aria-label": label, value: draft, onChange: (event) => setDraft(event.target.value), onBlur: () => onCommit(draft) })) : (_jsx("input", { "aria-label": label, value: draft, onChange: (event) => setDraft(event.target.value), onBlur: () => onCommit(draft) }));
}
function StyleInput({ name, value, inherited, update, }) {
    const [separate, setSeparate] = useState(value.trim().split(/\s+/).length > 1);
    const [draft, setDraft] = useState(value);
    const [previous, setPrevious] = useState(value);
    if (previous !== value) {
        setPrevious(value);
        setDraft(value);
    }
    const change = (next) => {
        setDraft(next);
        update(next);
    };
    if (name === 'backgroundImage') {
        const match = /^linear-gradient\((\d+)deg, (#[a-fA-F0-9]{6}), (#[a-fA-F0-9]{6})\)$/.exec(value);
        const angle = match?.[1] ?? '90', first = match?.[2] ?? '#ffffff', second = match?.[3] ?? '#333333';
        const gradient = (direction, start, end) => update(`linear-gradient(${direction}deg, ${start}, ${end})`);
        return (_jsxs("fieldset", { children: [_jsx("legend", { children: "Gradient" }), _jsxs("label", { children: ["Start color", _jsx("input", { type: "color", value: first, onChange: (event) => gradient(angle, event.target.value, second) })] }), _jsxs("label", { children: ["End color", _jsx("input", { type: "color", value: second, onChange: (event) => gradient(angle, first, event.target.value) })] }), _jsxs("label", { children: ["Angle", _jsx("input", { type: "range", min: "0", max: "360", value: angle, onChange: (event) => gradient(event.target.value, first, second) })] }), _jsx("button", { type: "button", onClick: () => gradient(angle, first, second), children: "Apply gradient" }), _jsx("button", { type: "button", onClick: () => update(''), children: "Reset gradient" })] }));
    }
    if (name === 'padding' || name === 'margin') {
        const parts = value.split(/\s+/), sides = [
            parts[0],
            parts[1] ?? parts[0],
            parts[2] ?? parts[0],
            parts[3] ?? parts[1] ?? parts[0],
        ];
        return (_jsxs("fieldset", { children: [_jsx("legend", { children: title(name) }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !separate, onChange: (event) => setSeparate(!event.target.checked) }), "Linked sides"] }), separate ? (['Top', 'Right', 'Bottom', 'Left'].map((side, index) => (_jsxs("label", { children: [side, _jsx("input", { value: sides[index] ?? '', onChange: (event) => {
                                const next = sides.map((value) => value || '0');
                                next[index] = event.target.value || '0';
                                change(next.join(' '));
                            } })] }, side)))) : (_jsx("input", { "aria-label": title(name), value: draft, placeholder: inherited ?? 'Inherit', onChange: (event) => change(event.target.value) })), _jsxs("button", { type: "button", onClick: () => change(''), children: ["Reset ", title(name)] })] }));
    }
    const unit = /^(-?[\d.]+)(px|rem|em|%|vh|vw)$/.exec(value);
    const dimension = /^(width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|letterSpacing|gap|borderWidth|borderRadius|top|right|bottom|left)$/.test(name);
    return (_jsxs("label", { children: [title(name), _jsxs("div", { className: "block-inspector-control", children: [styleOptions[name] ? (_jsxs("select", { value: value, onChange: (event) => change(event.target.value), children: [_jsx("option", { value: "", children: "Inherit" }), styleOptions[name].map((item) => (_jsx("option", { children: item }, item)))] })) : (_jsxs(_Fragment, { children: [_jsx("input", { "aria-label": title(name), value: draft, placeholder: inherited ?? 'Inherit', onChange: (event) => change(event.target.value) }), dimension && (_jsxs(_Fragment, { children: [_jsx("input", { "aria-label": `${title(name)} slider`, type: "range", min: "0", max: name === 'fontSize' ? 200 : 1000, value: Number(unit?.[1]) || 0, onChange: (event) => change(`${event.target.value}${unit?.[2] ?? 'px'}`) }), _jsx("select", { "aria-label": `${title(name)} unit`, value: unit?.[2] ?? 'px', onChange: (event) => change(`${unit?.[1] ?? 0}${event.target.value}`), children: ['px', 'rem', 'em', '%', 'vh', 'vw'].map((value) => (_jsx("option", { children: value }, value))) })] })), /Color$|^color$/.test(name) && (_jsx("input", { "aria-label": `${title(name)} picker`, type: "color", value: /^#[\da-f]{6}$/i.test(value) ? value : '#000000', onChange: (event) => change(event.target.value) }))] })), _jsx("button", { type: "button", "aria-label": `Reset ${title(name)}`, onClick: () => change(''), children: "\u21BA" })] })] }));
}
