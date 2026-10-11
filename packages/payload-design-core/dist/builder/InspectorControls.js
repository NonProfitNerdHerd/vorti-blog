'use client';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useId, useRef, useState, } from 'react';
import { createPortal } from 'react-dom';
export const InspectorDevice = createContext(null);
export const InspectorGesture = { active: false, changed: false, pending: false };
export function markInspectorGesture() {
    InspectorGesture.pending = false;
    if (InspectorGesture.active)
        InspectorGesture.changed = true;
}
export function beginInspectorGesture() {
    InspectorGesture.pending = true;
    InspectorGesture.active = true;
    InspectorGesture.changed = false;
}
export function endInspectorGesture() {
    InspectorGesture.active = false;
    InspectorGesture.changed = false;
}
export function InspectorIcon({ name }) {
    const paths = {
        menu: _jsx("path", { d: "M4 6h16M4 12h16M4 18h16" }),
        layout: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "16", rx: "1" }), _jsx("path", { d: "M3 9h18M9 9v11" })] })),
        style: _jsx("path", { d: "m14 3 7 7-9 9-7-7zM5 12l-2 9 9-2M14 5l5 5" }),
        advanced: (_jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "12", r: "4" }), _jsx("path", { d: "M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3M16 8l3-3" })] })),
        desktop: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "3", y: "3", width: "18", height: "13", rx: "1" }), _jsx("path", { d: "M12 16v5M7 21h10" })] })),
        tablet: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "5", y: "2", width: "14", height: "20", rx: "2" }), _jsx("path", { d: "M11 18h2" })] })),
        mobile: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "7", y: "2", width: "10", height: "20", rx: "2" }), _jsx("path", { d: "M11 18h2" })] })),
        reset: (_jsx(_Fragment, { children: _jsx("path", { d: "M4 10a8 8 0 1 1 1 8M4 3v7h7" }) })),
        linked: (_jsx("path", { d: "m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" })),
        unlinked: _jsx("path", { d: "m3 3 18 18M8 16l-1 1a4 4 0 0 1-6-6l3-3m12-1 1-1a4 4 0 0 1 6 6l-3 3" }),
        top: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "4", y: "4", width: "16", height: "16", opacity: ".3" }), _jsx("path", { strokeWidth: "4", d: "M4 4h16" })] })),
        right: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "4", y: "4", width: "16", height: "16", opacity: ".3" }), _jsx("path", { strokeWidth: "4", d: "M20 4v16" })] })),
        bottom: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "4", y: "4", width: "16", height: "16", opacity: ".3" }), _jsx("path", { strokeWidth: "4", d: "M4 20h16" })] })),
        left: (_jsxs(_Fragment, { children: [_jsx("rect", { x: "4", y: "4", width: "16", height: "16", opacity: ".3" }), _jsx("path", { strokeWidth: "4", d: "M4 4v16" })] })),
    };
    return (_jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true", children: paths[name] ?? _jsx("path", { d: "M4 6h16M4 12h10M4 18h16" }) }));
}
export function IconButton({ label, icon, onClick, pressed, disabled, }) {
    return (_jsx("button", { type: "button", className: "inspector-icon", title: label, "aria-label": label, "aria-pressed": pressed, disabled: disabled, onClick: onClick, children: _jsx(InspectorIcon, { name: icon }) }));
}
export function InspectorToggle({ open, change, }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const key = (event) => {
            if (event.key === 'Escape' &&
                !event.defaultPrevented &&
                event.target instanceof Element &&
                (ref.current?.contains(event.target) ||
                    event.target.closest('.content-workspace__right, .template-editor__sidebar--right')) &&
                ref.current?.getClientRects().length &&
                !document.querySelector('.inspector-popover')) {
                event.preventDefault();
                event.stopPropagation();
                change(false);
                ref.current?.focus();
            }
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, [open, change]);
    return (_jsx("button", { ref: ref, type: "button", className: "inspector-toggle", "aria-label": "Toggle inspector", title: open ? 'Hide inspector' : 'Show inspector', "aria-expanded": open, onClick: () => change(!open), children: _jsx(InspectorIcon, { name: "menu" }) }));
}
export function Popover({ label, trigger, children, }) {
    const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, left: 0 });
    const button = useRef(null), panel = useRef(null), id = useId();
    useEffect(() => {
        if (!open)
            return;
        const place = () => {
            const r = button.current.getBoundingClientRect();
            setPosition({
                left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
                top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - (panel.current?.offsetHeight ?? 300) - 8)),
            });
        };
        place();
        panel.current?.querySelector('input,button,select')?.focus();
        const outside = (e) => {
            if (!e.target?.closest?.('.inspector-popover') &&
                !panel.current?.contains(e.target) &&
                !button.current?.contains(e.target)) {
                setOpen(false);
                button.current?.focus();
            }
        };
        const key = (e) => {
            if (e.key === 'Escape' &&
                !e.defaultPrevented &&
                document
                    .querySelectorAll('.inspector-popover')
                    .item(document.querySelectorAll('.inspector-popover').length - 1) === panel.current) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
            }
        };
        document.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', key, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('keydown', key, true);
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);
    return (_jsxs(_Fragment, { children: [_jsx("button", { ref: button, type: "button", title: label, "aria-label": label, "aria-expanded": open, "aria-controls": open ? id : undefined, onClick: () => setOpen(!open), children: trigger }), open &&
                createPortal(_jsx("div", { id: id, ref: panel, role: "dialog", "aria-label": label, className: "inspector-popover", style: { position: 'fixed', ...position }, children: children }), document.body)] }));
}
export function DeviceControl({ label }) {
    const device = useContext(InspectorDevice);
    if (!device)
        return null;
    return (_jsx(Popover, { label: `${label} device`, trigger: _jsx(InspectorIcon, { name: device.viewport }), children: _jsx("div", { className: "inspector-segments", children: ['desktop', 'tablet', 'mobile'].map((value) => (_jsx(IconButton, { label: value === 'mobile' ? 'Phone' : value === 'desktop' ? 'Desktop' : 'Tablet', icon: value, pressed: device.viewport === value, onClick: () => device.change(value) }, value))) }) }));
}
export function DimensionControl({ label, value, update, units = ['px', 'rem', 'em', '%', 'vh', 'vw'], negative = false, }) {
    const [draft, setDraft] = useState(value), [previous, setPrevious] = useState(value);
    if (previous !== value) {
        setPrevious(value);
        setDraft(value);
    }
    const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw)?$/.exec(value);
    const unit = match?.[2] ?? units[0] ?? '', number = Number(match?.[1] ?? 0);
    return (_jsxs("div", { className: "inspector-dimension", onPointerDown: beginInspectorGesture, onPointerUp: endInspectorGesture, onPointerCancel: endInspectorGesture, onFocus: beginInspectorGesture, onBlur: endInspectorGesture, children: [_jsx("input", { "aria-label": `${label} slider`, type: "range", min: negative ? -1000 : 0, max: unit === '%' ? 100 : unit === 'rem' || unit === 'em' ? 100 : 1000, step: unit === 'rem' || unit === 'em' ? 0.1 : 1, value: number, onChange: (e) => update(`${e.target.value}${unit}`) }), _jsx("input", { "aria-label": label, value: draft && !/^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw)?$/.test(draft)
                    ? draft
                    : draft.replace(/(px|rem|em|%|vh|vw)$/, ''), placeholder: "Inherit", onChange: (e) => {
                    setDraft(e.target.value);
                    if (e.target.value === '' ||
                        /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?$/.test(e.target.value) ||
                        e.target.value === 'auto')
                        update(e.target.value === ''
                            ? ''
                            : /^-?\d+(\.\d+)?$/.test(e.target.value)
                                ? `${e.target.value}${unit}`
                                : e.target.value);
                }, onBlur: () => setDraft(value) }), units.length > 0 && (_jsx(Popover, { label: `${label} unit`, trigger: unit, children: _jsx("div", { className: "inspector-segments", children: units.map((u) => (_jsx("button", { type: "button", "aria-pressed": unit === u, onClick: () => update(`${number}${u}`), children: u }, u))) }) }))] }));
}
