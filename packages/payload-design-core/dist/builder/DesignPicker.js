'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Link from 'next/link';
export function orderedDesigns(designs, type) {
    return designs
        .filter((design) => String(typeof design.blockType === 'object'
        ? design.blockType.id
        : design.blockType) === String(type))
        .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}
/** Visual structural previews use the same published primitives as rendering. */
export function DesignPicker({ designs, value, onChange, onDone, }) {
    if (!designs.length)
        return (_jsxs("p", { children: ["No published designs are available.", ' ', _jsx(Link, { href: "/admin/collections/design-block-types", children: "Open Block Creator" }), " to publish a design before inserting this block."] }));
    return (_jsxs("fieldset", { children: [_jsx("legend", { children: onDone ? 'Select a design to start with' : 'Layout designs' }), _jsx("div", { onKeyDown: (event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                        return;
                    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
                    const index = buttons.indexOf(event.target);
                    if (index < 0)
                        return;
                    event.preventDefault();
                    const next = event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                            ? buttons.length - 1
                            : (index +
                                (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                                buttons.length) %
                                buttons.length;
                    buttons[next]?.focus();
                }, style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                    gap: 8,
                }, children: designs.map((design) => {
                    const primitive = design.primitives ?? design.design ?? {};
                    const split = primitive.imageTreatment === 'split';
                    const feature = primitive.imageTreatment === 'feature';
                    return (_jsxs("button", { type: "button", "aria-pressed": String(value) === String(design.id), onClick: () => {
                            onChange(design.id);
                            onDone?.();
                        }, children: [_jsxs("svg", { viewBox: "0 0 120 70", "aria-hidden": "true", style: { display: 'block', width: '100%', height: 65 }, children: [_jsx("rect", { x: "2", y: "2", width: "116", height: "66", rx: "2", fill: "none", stroke: "currentColor" }), _jsx("rect", { x: split ? 62 : feature ? 25 : 6, y: feature ? 12 : 6, width: split ? 52 : feature ? 88 : 108, height: feature ? 46 : 58, fill: "currentColor", opacity: primitive.overlay === 'dark' ? 0.3 : 0.12 }), _jsx("path", { d: primitive.alignment === 'center'
                                            ? 'M35 24h50 M25 33h70 M45 46h30'
                                            : 'M12 24h38 M12 33h42 M12 46h25', stroke: "currentColor", strokeWidth: "4" })] }), design.name] }, design.id));
                }) }), onDone && (_jsx("button", { type: "button", onClick: onDone, children: "Skip" }))] }));
}
