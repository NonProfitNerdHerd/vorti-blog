'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
/** Native dialog provides focus containment, Escape dismissal, and return focus. */
export function FormBuilderDialog({ title, close, anchor, children }) {
    const ref = useRef(null), id = useId();
    useEffect(() => {
        const dialog = ref.current, previous = document.activeElement;
        dialog.showModal();
        if (anchor?.current) {
            const bounds = anchor.current.getBoundingClientRect();
            dialog.style.margin = '0';
            dialog.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - dialog.offsetWidth - 12))}px`;
            dialog.style.top = `${Math.max(12, Math.min(bounds.bottom + 8, innerHeight - dialog.offsetHeight - 12))}px`;
        }
        return () => { dialog.close(); if (previous?.isConnected)
            previous.focus(); };
    }, [anchor]);
    return createPortal(_jsxs("dialog", { ref: ref, className: "forms-builder forms-part-dialog", "aria-labelledby": id, onCancel: event => { event.preventDefault(); close(); }, onClick: event => { if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
                close();
        } }, children: [_jsxs("div", { className: "forms-dialog-heading", children: [_jsx("h2", { id: id, children: title }), _jsx("button", { type: "button", "aria-label": "Close dialog", onClick: close, children: _jsx(X, { size: 18 }) })] }), children] }), document.body);
}
