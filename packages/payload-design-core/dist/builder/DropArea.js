'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and reactive drop state through its hook result. */
import { useDroppable } from '@dnd-kit/core';
import { takePendingLibraryItem } from './BuilderLibrary.js';
export function DropArea({ add, addItem, children, id, label, }) {
    const drop = useDroppable({ id: `container:${id}`, data: { containerID: id } });
    return (_jsx("div", { className: "template-editor__drop-area", children: _jsxs("div", { ref: drop.setNodeRef, className: "template-editor__drop-target", "data-over": drop.isOver, "aria-label": label, onPointerUp: (event) => {
                event.stopPropagation();
                const item = takePendingLibraryItem();
                if (item && addItem)
                    addItem(item);
            }, onDragOver: (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
            }, onDrop: (event) => {
                event.preventDefault();
                event.stopPropagation();
                takePendingLibraryItem();
                const value = event.dataTransfer.getData('application/x-template-library') || event.dataTransfer.getData('text/plain');
                if (!value || !addItem)
                    return;
                try {
                    addItem(JSON.parse(value));
                }
                catch { /* ignore invalid external drag data */ }
            }, children: [_jsx("div", { className: "template-editor__inserter-row", children: add && (_jsx("button", { type: "button", className: "template-editor__inserter", "aria-label": `Add element to ${label}`, title: `Add element to ${label}`, onClick: add, children: "+" })) }), children] }) }));
}
