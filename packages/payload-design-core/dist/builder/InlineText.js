'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
export function InlineText({ node, disabled, onChange, }) {
    const input = React.useRef(null);
    React.useLayoutEffect(() => {
        const element = input.current;
        if (!element)
            return;
        const fit = () => {
            element.style.height = '0px';
            element.style.height = `${element.scrollHeight}px`;
        };
        fit();
        let active = true;
        void document.fonts?.ready.then(() => {
            if (active)
                fit();
        });
        let width = element.clientWidth;
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => {
            if (width !== element.clientWidth) {
                width = element.clientWidth;
                fit();
            }
        });
        observer.observe(element);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [node.text, node.styles, node.presentation]);
    return (_jsx("textarea", { ref: input, className: `content-workspace__inline content-workspace__inline--${node.kind}`, "aria-label": node.label ?? node.kind, placeholder: `Type ${node.kind}…`, value: node.text ?? '', readOnly: disabled, rows: 1, onChange: (event) => onChange(event.target.value) }));
}
