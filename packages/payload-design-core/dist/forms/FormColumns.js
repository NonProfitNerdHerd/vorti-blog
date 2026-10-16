'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { columnTracks } from './columns.js';
/** Measure the actual viewport instead of using 100vw, which includes the scrollbar. */
export function FormColumns({ field, preview, disabled, children }) {
    const ref = useRef(null);
    const width = field.layout?.kind === 'columns' ? field.layout.width : undefined;
    useEffect(() => {
        const element = ref.current;
        if (!element || width !== 'full')
            return;
        const root = element.closest('.forms-runtime');
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const left = element.getBoundingClientRect().left - (parseFloat(element.style.marginLeft) || 0);
                const boundary = preview ? root.getBoundingClientRect() : { left: 0, width: document.documentElement.clientWidth };
                element.style.width = `${boundary.width}px`;
                element.style.marginLeft = `${boundary.left - left}px`;
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        observer.observe(document.documentElement);
        window.addEventListener('resize', measure);
        measure();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); element.style.removeProperty('width'); element.style.removeProperty('margin-left'); };
    }, [preview, width]);
    return _jsx("fieldset", { ref: ref, disabled: disabled, className: `forms-layout-columns forms-layout-${width || 'inherit'}`, "aria-label": field.label, children: _jsx("div", { className: "forms-column-grid", style: { gridTemplateColumns: columnTracks(field) }, children: children }) });
}
