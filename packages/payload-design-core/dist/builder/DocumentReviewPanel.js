'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorHeaderPortal } from './EditorHeader.js';
/** Application-owned review UI; no persistence or permission decisions live here. */
export function DocumentReviewPanel({ children, count, open, onOpenChange, disabled = false, }) {
    const marker = useRef(null);
    const trigger = useRef(null);
    const panel = useRef(null);
    const [host, setHost] = useState(null);
    useEffect(() => {
        const locate = () => {
            const boundary = marker.current?.closest('.doc-drawer, [role="dialog"]') ?? null;
            const scope = boundary ?? document;
            const frame = Array.from(scope.querySelectorAll('.builder-frame')).find((el) => el.closest('.doc-drawer, [role="dialog"]') === boundary);
            setHost(frame ?? boundary ?? document.body);
        };
        locate();
        const observer = new MutationObserver(locate);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!open)
            return;
        panel.current?.focus();
        const escape = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented)
                return;
            if (panel.current?.querySelector('.editor-dialog-layer'))
                return;
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            trigger.current?.focus();
        };
        window.addEventListener('keydown', escape, true);
        const inspect = (event) => {
            if (event.detail.boundary !==
                (marker.current?.closest('.doc-drawer, [role="dialog"]') ?? null))
                return;
            event.preventDefault();
            onOpenChange(false);
        };
        window.addEventListener('editor:show-inspector', inspect);
        return () => {
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('editor:show-inspector', inspect);
        };
    }, [open, onOpenChange]);
    return (_jsxs(_Fragment, { children: [_jsx("span", { ref: marker, hidden: true }), _jsx(EditorHeaderPortal, { slot: "actions", waitForTarget: true, children: _jsxs("button", { ref: trigger, type: "button", disabled: disabled, "aria-expanded": open, onClick: () => onOpenChange(!open), children: ["Tasks (", count, ")"] }) }), open &&
                host &&
                createPortal(_jsxs("aside", { ref: panel, tabIndex: -1, className: `document-review-panel ${host.classList.contains('builder-frame') ? '' : 'document-review-panel--floating'}`, "aria-label": "Document tasks", children: [_jsxs("header", { children: [_jsx("strong", { children: "Tasks" }), _jsx("button", { type: "button", "aria-label": "Close tasks", onClick: () => {
                                        onOpenChange(false);
                                        trigger.current?.focus();
                                    }, children: "\u00D7" })] }), children] }), host)] }));
}
