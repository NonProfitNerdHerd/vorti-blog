'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import './editor-dialog.css';
/** Keeps inline controls mounted while expanding them into a centered editor. */
export function EditorDialog({ open, inline = false, title, onClose, children, }) {
    const ref = useRef(null);
    const id = useId();
    useEffect(() => {
        if (!open)
            return;
        const key = (event) => {
            if (event.defaultPrevented || Array.from(document.querySelectorAll('.editor-dialog-layer')).at(-1) !== ref.current)
                return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
            else if (event.key === 'Tab' && event.target instanceof Node && !ref.current?.contains(event.target)) {
                event.preventDefault();
                ref.current?.querySelector('[data-dialog-close]')?.focus();
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [open, onClose]);
    useEffect(() => {
        if (!open)
            return;
        const previous = document.activeElement;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        ref.current?.querySelector('[data-dialog-close]')?.focus();
        return () => {
            document.body.style.overflow = overflow;
            requestAnimationFrame(() => {
                if (previous?.isConnected)
                    previous.focus();
            });
        };
    }, [open]);
    if (!open && !inline)
        return null;
    return (_jsx("div", { ref: ref, className: open ? 'editor-dialog-layer' : 'editor-dialog-inline', role: open ? 'dialog' : undefined, "aria-modal": open ? true : undefined, "aria-labelledby": open ? id : undefined, onMouseDown: (event) => {
            if (open && event.target === event.currentTarget)
                onClose();
        }, onKeyDown: (event) => {
            if (!open || event.defaultPrevented)
                return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
            if (event.key === 'Tab') {
                const items = Array.from(ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden], [inert]'));
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        }, children: _jsxs("div", { className: open ? 'editor-dialog-card' : undefined, children: [_jsxs("header", { className: "editor-dialog-heading", hidden: !open, children: [_jsx("h2", { id: id, children: title }), _jsx("button", { "data-dialog-close": true, type: "button", "aria-label": "Close dialog", onClick: onClose, children: _jsx(X, { size: 20 }) })] }), _jsx("div", { className: open ? 'editor-dialog-content' : undefined, children: children })] }) }));
}
