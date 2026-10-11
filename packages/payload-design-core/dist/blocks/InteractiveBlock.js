'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Children, useEffect, useRef, useState } from 'react';
import { safeURL } from '../content/model.js';
export default function InteractiveBlock({ node, children, editing = false, }) {
    const props = node.props ?? {};
    const [active, setActive] = useState(0);
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [paused, setPaused] = useState(false);
    const [count, setCount] = useState(Number(props.start ?? 0));
    const [now, setNow] = useState(null);
    const dialog = useRef(null);
    const trigger = useRef(null);
    const items = Children.toArray(children);
    useEffect(() => {
        if (editing)
            return;
        if (node.kind === 'countdown') {
            const timer = setInterval(() => setNow(Date.now()), 1000);
            return () => clearInterval(timer);
        }
        if (node.kind === 'countUp') {
            const end = Number(props.value ?? 100), start = Number(props.start ?? 0);
            if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const frame = requestAnimationFrame(() => setCount(end));
                return () => cancelAnimationFrame(frame);
            }
            const began = performance.now(), duration = Math.max(0.1, Number(props.duration ?? 2)) * 1000;
            let frame = 0;
            const step = (time) => {
                const progress = Math.min(1, (time - began) / duration);
                setCount(Math.round(start + (end - start) * progress));
                if (progress < 1)
                    frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
            return () => cancelAnimationFrame(frame);
        }
        if (node.kind === 'carousel' &&
            props.autoplay &&
            !paused &&
            items.length > 1 &&
            !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const timer = setInterval(() => setActive((value) => (value + 1) % items.length), Math.max(2, Number(props.interval ?? 5)) * 1000);
            return () => clearInterval(timer);
        }
    }, [
        editing,
        node.kind,
        props.value,
        props.start,
        props.duration,
        props.autoplay,
        props.interval,
        paused,
        items.length,
    ]);
    if (editing && ['accordion', 'tabs', 'carousel', 'expand', 'notification'].includes(node.kind))
        return _jsx("div", { children: children });
    if (node.kind === 'notification')
        return dismissed ? null : (_jsxs("aside", { role: "status", children: [children, props.dismissible !== false && (_jsx("button", { type: "button", onClick: () => setDismissed(true), "aria-label": "Dismiss notification", children: "\u00D7" }))] }));
    if (node.kind === 'expand')
        return (_jsxs("div", { children: [_jsx("button", { type: "button", "aria-expanded": open, "aria-controls": `${node.id}-expanded`, onClick: () => setOpen(!open), children: String(open ? (props.collapseLabel ?? 'Show less') : (props.label ?? 'Read more')) }), _jsx("div", { id: `${node.id}-expanded`, hidden: !open, children: children })] }));
    if (node.kind === 'accordion')
        return (_jsx("div", { children: items.map((item, index) => (_jsxs("details", { name: props.multiple ? undefined : node.id, children: [_jsx("summary", { children: node.children?.[index]?.label || `Item ${index + 1}` }), item] }, index))) }));
    if (node.kind === 'tabs')
        return (_jsxs("div", { children: [_jsx("div", { role: "tablist", "aria-label": node.label || 'Tabs', children: items.map((_, index) => (_jsx("button", { type: "button", role: "tab", id: `${node.id}-tab-${index}`, "aria-selected": index === active, "aria-controls": `${node.id}-panel-${index}`, tabIndex: index === active ? 0 : -1, onClick: () => setActive(index), onKeyDown: (event) => {
                            const next = event.key === 'ArrowRight'
                                ? (active + 1) % items.length
                                : event.key === 'ArrowLeft'
                                    ? (active - 1 + items.length) % items.length
                                    : event.key === 'Home'
                                        ? 0
                                        : event.key === 'End'
                                            ? items.length - 1
                                            : -1;
                            if (next >= 0) {
                                event.preventDefault();
                                setActive(next);
                                document.getElementById(`${node.id}-tab-${next}`)?.focus();
                            }
                        }, children: node.children?.[index]?.label || `Tab ${index + 1}` }, index))) }), items.map((item, index) => (_jsx("div", { role: "tabpanel", tabIndex: 0, id: `${node.id}-panel-${index}`, "aria-labelledby": `${node.id}-tab-${index}`, hidden: active !== index, children: item }, index)))] }));
    if (node.kind === 'carousel')
        return (_jsxs("section", { "aria-roledescription": "carousel", "aria-label": node.label || 'Carousel', onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onFocus: () => setPaused(true), children: [_jsx("div", { "aria-live": paused || !props.autoplay ? 'polite' : 'off', children: items.map((item, index) => (_jsx("div", { hidden: index !== active, role: "group", "aria-label": `${index + 1} of ${items.length}`, children: item }, index))) }), _jsx("button", { type: "button", onClick: () => setActive((active - 1 + items.length) % items.length), disabled: items.length < 2, children: "Previous slide" }), _jsx("button", { type: "button", onClick: () => setActive((active + 1) % items.length), disabled: items.length < 2, children: "Next slide" }), !!props.autoplay && (_jsx("button", { type: "button", onClick: () => setPaused(!paused), children: paused ? 'Play slides' : 'Pause slides' }))] }));
    if (node.kind === 'countUp')
        return (_jsxs("span", { children: [String(props.prefix ?? ''), editing ? Number(props.value ?? 100) : count, String(props.suffix ?? '')] }));
    if (node.kind === 'countdown') {
        const deadline = Date.parse(String(props.deadline ?? ''));
        if (!Number.isFinite(deadline))
            return _jsx("span", { children: "Set a countdown deadline." });
        if (now === null)
            return _jsx("time", { dateTime: String(props.deadline), children: String(props.deadline) });
        const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
        return seconds ? (_jsxs("span", { role: "timer", children: [Math.floor(seconds / 86400), "d ", Math.floor(seconds / 3600) % 24, "h", ' ', Math.floor(seconds / 60) % 60, "m ", seconds % 60, "s"] })) : (_jsx("span", { children: String(props.completeText ?? 'The time has arrived') }));
    }
    if (node.kind === 'videoPopup' || node.presentation?.link?.lightbox) {
        const url = safeURL(String(props.url ?? node.presentation?.link?.url ?? node.media?.url ?? ''));
        let embedded = '';
        try {
            const parsed = new URL(url);
            if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(parsed.hostname)) {
                const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
                if (id && /^[\w-]+$/.test(id))
                    embedded = `https://www.youtube-nocookie.com/embed/${id}`;
            }
            else if (['vimeo.com', 'www.vimeo.com'].includes(parsed.hostname) &&
                /^\/\d+$/.test(parsed.pathname))
                embedded = `https://player.vimeo.com/video${parsed.pathname}`;
        }
        catch {
            /* Relative hosted media is also supported. */
        }
        return (_jsxs(_Fragment, { children: [_jsx("button", { ref: trigger, type: "button", disabled: editing || !url, onClick: () => {
                        setOpen(true);
                        dialog.current?.showModal();
                    }, children: children || String(props.label ?? 'Play video') }), _jsxs("dialog", { ref: dialog, "aria-label": "Media viewer", onClose: () => {
                        setOpen(false);
                        trigger.current?.focus();
                    }, children: [_jsx("button", { type: "button", onClick: () => dialog.current?.close(), children: "Close media" }), open &&
                            (embedded ? (_jsx("iframe", { src: embedded, title: "Video", allow: "fullscreen", style: { width: 'min(80vw, 960px)', aspectRatio: '16 / 9' } })) : node.kind === 'videoPopup' ? (_jsx("video", { src: url, controls: true, style: { maxWidth: '80vw' } })) : (children))] })] }));
    }
    return _jsx(_Fragment, { children: children });
}
