'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { resolveBackground, } from '../blocks/presentation.js';
import { PaintControl, FocalPoint } from './VisualStyleControl.js';
import { DeviceControl } from './InspectorControls.js';
export function BackgroundControls({ background, device, change, renderMedia, color, gradient, styleChange, reset, }) {
    const value = resolveBackground(background, device);
    const mode = value.mode ?? (value.imageURL ? 'image' : gradient ? 'gradient' : 'solid');
    const update = (patch) => change(device === 'desktop'
        ? { ...background, ...patch }
        : {
            ...background,
            responsive: {
                ...background?.responsive,
                [device]: { ...background?.responsive?.[device], ...patch },
            },
        });
    return (_jsxs("details", { children: [_jsx("summary", { children: "Background" }), _jsxs("div", { className: "inspector-property-heading", children: [_jsx("span", { children: "Background type" }), _jsx(DeviceControl, { label: "Background" })] }), _jsx("div", { className: "inspector-segments", children: ['solid', 'gradient', 'image'].map((modeOption) => (_jsx("button", { type: "button", "aria-pressed": mode === modeOption, onClick: () => update({ mode: modeOption }), children: modeOption }, modeOption))) }), mode === 'solid' && (_jsx(PaintControl, { label: "Background color", value: color, update: (color) => styleChange('backgroundColor', color) })), mode === 'gradient' && (_jsx(PaintControl, { label: "Background gradient", value: gradient, gradient: true, update: (gradient) => styleChange('backgroundImage', gradient) })), mode === 'image' && (_jsxs(_Fragment, { children: [renderMedia?.(value, update), _jsxs("label", { children: ["Background image URL", _jsx("input", { type: "text", defaultValue: value.imageURL ?? '', onBlur: (event) => update({ imageURL: event.target.value }) }, value.imageURL)] }), _jsx(FocalPoint, { url: value.imageURL, value: value.position ?? '50% 50%', update: (position) => update({ position }) }), _jsxs("label", { children: ["Image fit", _jsx("select", { value: value.fit ?? 'cover', onChange: (event) => update({ fit: event.target.value }), children: ['cover', 'contain', 'auto'].map((option) => (_jsx("option", { children: option }, option))) })] }), _jsxs("label", { children: ["Image repeat", _jsx("select", { value: value.repeat ?? 'no-repeat', onChange: (event) => update({ repeat: event.target.value }), children: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].map((option) => (_jsx("option", { children: option }, option))) })] })] })), _jsx(PaintControl, { label: "Overlay color", value: value.overlay ?? '', update: (overlay) => update({ overlay, gradient: '', opacity: value.opacity ?? 1 }) }), _jsx(PaintControl, { label: "Overlay gradient", value: value.gradient ?? '', gradient: true, update: (gradient) => update({ gradient, opacity: value.opacity ?? 1 }) }), _jsxs("label", { children: ["Overlay opacity", _jsx("input", { type: "range", min: 0, max: 1, step: 0.05, value: value.opacity ?? 0, onChange: (event) => update({ opacity: Number(event.target.value) }) })] }), _jsxs("label", { children: ["Overlay blend mode", _jsx("select", { value: value.blendMode ?? 'normal', onChange: (event) => update({ blendMode: event.target.value }), children: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].map((option) => (_jsx("option", { children: option }, option))) })] }), _jsxs("button", { type: "button", onClick: reset, children: ["Reset ", device, " background"] }), device !== 'desktop' && !background?.responsive?.[device] && (_jsx("small", { children: "Inherited from larger devices" }))] }));
}
