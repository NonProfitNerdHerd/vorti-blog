'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
let pendingPointerItem = null;
export function takePendingLibraryItem() {
    const item = pendingPointerItem;
    pendingPointerItem = null;
    return item;
}
export function BuilderLibraryButton({ item, onAdd }) {
    return (_jsxs("div", { className: "template-editor__library-item", children: [_jsx("button", { type: "button", className: "template-editor__library-icon", draggable: true, "aria-label": `Drag ${item.label}`, onPointerDown: () => { pendingPointerItem = item; }, onPointerCancel: () => { pendingPointerItem = null; }, onDragStart: (event) => {
                    const serialized = JSON.stringify(item);
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-template-library', serialized);
                    event.dataTransfer.setData('text/plain', serialized);
                }, children: item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶' }), _jsx("button", { type: "button", className: "template-editor__library-action", onClick: onAdd, children: item.label })] }));
}
