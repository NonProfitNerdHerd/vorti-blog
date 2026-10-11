'use client';
import { useLayoutEffect, useRef } from 'react';
/** Measure the application-owned header in the current document/drawer only. */
export function useWorkspaceFrame() {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const frame = ref.current;
        if (!frame)
            return;
        const boundary = frame.closest('.doc-drawer, [role="dialog"]');
        const scope = boundary ?? document;
        let tick = 0;
        const measure = () => {
            const controls = Array.from(scope.querySelectorAll('.doc-controls')).find((element) => element.closest('.doc-drawer, [role="dialog"]') === boundary);
            const bounds = boundary?.getBoundingClientRect();
            const header = controls?.getBoundingClientRect();
            const own = frame.getBoundingClientRect();
            // Payload's drawer content is transformed, so fixed descendants use its origin.
            const origin = frame.closest('.drawer__content')?.getBoundingClientRect();
            const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
            const top = Math.max(bounds?.top ?? 0, header?.bottom ?? own.top);
            frame.style.setProperty('--workspace-top', `${top - (origin?.top ?? 0)}px`);
            frame.style.setProperty('--workspace-height', `${Math.max(0, bottom - top)}px`);
            if (header) {
                frame.dataset.integrated = 'true';
                frame.style.setProperty('--workspace-left', `${header.left - (origin?.left ?? 0)}px`);
                frame.style.setProperty('--workspace-width', `${header.width}px`);
            }
        };
        const schedule = () => {
            cancelAnimationFrame(tick);
            tick = requestAnimationFrame(measure);
        };
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        resize?.observe(boundary ?? document.documentElement);
        scope
            .querySelectorAll('.doc-controls, .doc-header')
            .forEach((element) => resize?.observe(element));
        const mutations = new MutationObserver(schedule);
        mutations.observe(scope, { childList: true, subtree: true });
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        measure();
        return () => {
            cancelAnimationFrame(tick);
            resize?.disconnect();
            mutations.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
        };
    }, []);
    return ref;
}
