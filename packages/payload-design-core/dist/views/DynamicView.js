'use client';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/* eslint-disable @next/next/no-img-element -- Media is resolved by the application adapter. */
import { useEffect, useId, useRef, useState } from 'react';
import { useSiteFormat } from '../SiteFormatContext.js';
import { formatSiteDate, formatSiteTime } from '../site-format.js';
import { useCategoriesEnabled } from '../categories.js';
import { defaultView, getView, occurrenceLanes, } from './model.js';
import { eventInstant } from './schedule.js';
import { ContentBlock } from '../content/ContentRenderer.js';
import './views.css';
const eventLayouts = [
    'month',
    'week',
    'day',
    'year',
    'calendar',
    'list',
    'agenda',
    'grid',
    'tiles',
    'masonry',
    'timetable',
    'map',
    'slider',
    'carousel',
    'cover',
    'countdown',
    'widget',
    'single',
];
const dateFormatters = new Map();
const dateKey = (date, zone) => {
    let formatter = dateFormatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        if (dateFormatters.size >= 64)
            dateFormatters.clear();
        dateFormatters.set(zone, formatter);
    }
    return formatter.format(date);
};
export function ViewThumbnail({ kind }) {
    return (_jsx("svg", { viewBox: "0 0 64 40", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: "2", children: kind === 'calendar' ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "3", y: "4", width: "58", height: "32", rx: "2" }), _jsx("path", { d: "M3 13h58M17 13v23M32 13v23M47 13v23M3 25h58" })] })) : kind === 'list' ? (_jsxs(_Fragment, { children: [_jsx("path", { d: "M22 9h39M22 15h27M22 27h39M22 33h27" }), _jsx("rect", { x: "3", y: "7", width: "13", height: "10" }), _jsx("rect", { x: "3", y: "25", width: "13", height: "10" })] })) : kind === 'map' ? (_jsxs(_Fragment, { children: [_jsx("path", { d: "m3 9 17-5 24 7 17-5v27l-17 4-24-7-17 5Z" }), _jsx("circle", { cx: "34", cy: "19", r: "5" }), _jsx("path", { d: "m30 23 4 5 4-5" })] })) : kind === 'split' ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "3", y: "4", width: "29", height: "32" }), _jsx("path", { d: "M38 7h22M38 13h22M38 25h22M38 31h22" })] })) : kind === 'slider' ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "12", y: "5", width: "40", height: "27" }), _jsx("path", { d: "m7 15-5 5 5 5m50-10 5 5-5 5M27 37h10" })] })) : (_jsx(_Fragment, { children: [3, 24, 45].map((x) => (_jsxs("g", { children: [_jsx("rect", { x: x, y: "5", width: "16", height: "18" }), _jsx("path", { d: `M${x} 28h16M${x} 34h12` })] }, x))) })) }));
}
export function DynamicView({ viewID, initial, configuration, editing = false, }) {
    const id = useId(), [result, setResult] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const categoriesEnabled = useCategoriesEnabled() && result?.categoriesEnabled !== false;
    const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [tag, setTag] = useState(''), [page, setPage] = useState(1), [anchor, setAnchor] = useState(() => new Date()), [mode, setMode] = useState('month'), [slide, setSlide] = useState(0), [selected, setSelected] = useState(null), [refresh, setRefresh] = useState(0);
    const dialog = useRef(null), trigger = useRef(null), append = useRef(false);
    const cfg = configuration || result?.config || defaultView, zone = cfg.timezone || 'UTC', layout = cfg.layout, calendar = layout.startsWith('event-') &&
        ['month', 'week', 'day', 'year', 'calendar', 'timetable'].includes(layout.slice(6));
    const activeMode = layout === 'event-calendar' ? mode : layout === 'event-timetable' ? 'week' : layout.slice(6);
    const localAnchor = new Date(`${dateKey(anchor, zone)}T12:00:00Z`);
    const rangeStart = new Date(Date.UTC(localAnchor.getUTCFullYear(), activeMode === 'year' ? 0 : localAnchor.getUTCMonth(), activeMode === 'year' || activeMode === 'month' ? 1 : localAnchor.getUTCDate()));
    if (activeMode === 'week')
        rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeStart.getUTCDay());
    const rangeEnd = new Date(rangeStart);
    if (activeMode === 'year')
        rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 1);
    else if (activeMode === 'month')
        rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1);
    else
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + (activeMode === 'week' ? 7 : 1));
    const from = calendar
        ? new Date(eventInstant(rangeStart.toISOString().slice(0, 10), zone, false)).toISOString()
        : anchor.toISOString(), to = calendar
        ? new Date(eventInstant(rangeEnd.toISOString().slice(0, 10), zone, false)).toISOString()
        : new Date(anchor.getTime() + 90 * 86400000).toISOString();
    const configurationKey = configuration ? JSON.stringify(configuration) : '';
    useEffect(() => {
        // A changed central configuration or query starts a new placement result set.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPage(1);
        setSlide(0);
        append.current = false;
    }, [viewID, configurationKey, search, category, tag, from, to]);
    useEffect(() => {
        if (!viewID && !configurationKey)
            return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setBusy(true);
            setError('');
            try {
                const params = new URLSearchParams({
                    page: String(page),
                    search,
                    categories: categoriesEnabled ? category : '',
                    tags: tag,
                    from,
                    to,
                });
                if (viewID)
                    params.set('view', String(viewID));
                if (editing)
                    params.set('draft', 'true');
                const response = await fetch(configurationKey ? '/api/content-views' : `/api/content-views?${params}`, {
                    signal: controller.signal,
                    credentials: 'same-origin',
                    ...(configurationKey
                        ? {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                configuration: JSON.parse(configurationKey),
                                params: Object.fromEntries(params),
                            }),
                        }
                        : {}),
                });
                const data = (await response.json());
                if (!response.ok)
                    throw new Error(data.error || 'Unable to load content');
                setResult((previous) => append.current && previous
                    ? { ...data, items: [...previous.items, ...data.items] }
                    : data);
                append.current = false;
            }
            catch (e) {
                if (!controller.signal.aborted)
                    setError(e.message);
            }
            finally {
                if (!controller.signal.aborted)
                    setBusy(false);
            }
        }, configurationKey ? 250 : 100);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [viewID, configurationKey, editing, page, search, category, tag, from, to, refresh, categoriesEnabled]); // configurationKey captures the full configuration
    useEffect(() => {
        const update = () => {
            setRefresh((v) => v + 1);
            if (layout.startsWith('event-') && !calendar)
                setAnchor(new Date());
        };
        window.addEventListener('focus', update);
        const timer = window.setInterval(update, 60000);
        return () => {
            window.removeEventListener('focus', update);
            clearInterval(timer);
        };
    }, [layout, calendar]);
    useEffect(() => {
        if (selected)
            dialog.current?.showModal();
        else
            dialog.current?.close();
    }, [selected]);
    const siteFormat = useSiteFormat();
    const items = result?.items || [], format = (value) => `${formatSiteDate(value, siteFormat, zone)} ${formatSiteTime(value, siteFormat, zone)}`;
    const open = (item) => {
        trigger.current = document.activeElement;
        setSelected(item);
    };
    const close = () => {
        setSelected(null);
        trigger.current?.focus();
    };
    const categories = result?.facets?.categories || [
        ...new Map(items.flatMap((i) => i.categories || []).map((c) => [c.id, c])).values(),
    ], tags = result?.facets?.tags || [
        ...new Map(items.flatMap((i) => i.tags || []).map((c) => [c.id, c])).values(),
    ];
    function card(item, index) {
        return (_jsxs("article", { className: `cv-card cv-item-${index}`, children: [cfg.image !== false && item.image && (_jsx("a", { href: item.url, tabIndex: -1, "aria-hidden": "true", children: _jsx("img", { className: "cv-image", src: item.image, alt: "", loading: "lazy" }) })), _jsxs("div", { className: "cv-content", children: [categoriesEnabled && cfg.taxonomy !== false && !!item.categories?.length && (_jsx("p", { className: "cv-taxonomy", children: item.categories.map((c) => c.name).join(' · ') })), _jsx("h3", { className: "cv-title", children: cfg.dialog ? (_jsx("button", { type: "button", onClick: () => open(item), children: item.title })) : (_jsx("a", { href: item.url, children: item.title })) }), cfg.date !== false && (item.occurrence || item.date) && (_jsxs("p", { className: "cv-meta", children: [_jsx("time", { dateTime: item.occurrence?.start || item.date, children: format(item.occurrence?.start || item.date) }), item.occurrence?.allDay ? ' · All day' : ''] })), cfg.author && item.author && _jsxs("span", { className: "cv-meta", children: ["By ", item.author, " "] }), cfg.readingTime && _jsxs("span", { className: "cv-meta", children: [item.readingTime, " min read"] }), item.location && _jsx("p", { children: item.location }), cfg.excerpt !== false && item.excerpt && (_jsxs("p", { className: "cv-excerpt", children: [item.excerpt.slice(0, cfg.excerptLength || 180), item.excerpt.length > (cfg.excerptLength || 180) ? '…' : ''] })), _jsxs("a", { className: "cv-more", href: item.url, children: [item.occurrence ? 'Event details' : 'Read more', " ", _jsx("span", { "aria-hidden": "true", children: "\u2192" })] })] })] }, item.id));
    }
    function dayCell(date) {
        const key = date.toISOString().slice(0, 10), matching = items.filter((item) => item.occurrence &&
            dateKey(new Date(item.occurrence.start), zone) <= key &&
            dateKey(new Date(new Date(item.occurrence.end).getTime() - 1), zone) >= key);
        return (_jsxs("div", { className: "cv-day", children: [_jsx("time", { dateTime: key, children: date.getUTCDate() }), matching.map((item) => (_jsx("button", { type: "button", onClick: () => open(item), "aria-label": `${item.title}, ${key}`, children: item.title }, item.id)))] }, key));
    }
    const days = calendar ? Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) : 0;
    const isSlider = /slider|carousel|ticker/.test(layout);
    const CustomRenderer = getView(layout)?.render;
    const moveDate = (direction) => {
        const next = new Date(localAnchor);
        if (activeMode === 'year')
            next.setUTCFullYear(next.getUTCFullYear() + direction);
        else if (activeMode === 'month')
            next.setUTCMonth(next.getUTCMonth() + direction, 1);
        else
            next.setUTCDate(next.getUTCDate() + direction * (activeMode === 'week' ? 7 : 1));
        setAnchor(new Date(eventInstant(`${next.toISOString().slice(0, 10)}T12:00`, zone, false)));
    };
    return (_jsx(ContentBlock, { node: {
            id: `view-design-${id.replace(/[^\w-]/g, '')}`,
            kind: 'group',
            styles: cfg.design?.styles,
            presentation: cfg.design?.presentation,
        }, body: _jsxs("section", { id: `view-${id.replaceAll(':', '')}`, className: `content-view cv-${layout}`, "aria-busy": busy, style: {
                '--cv-columns': cfg.columns || 3,
                '--cv-tablet-columns': cfg.responsiveColumns?.tablet ?? 2,
                '--cv-mobile-columns': cfg.responsiveColumns?.mobile ?? 1,
                '--cv-gap': `${cfg.gap ?? 20}px`,
                '--cv-radius': `${cfg.radius ?? 6}px`,
                background: cfg.background,
                color: cfg.color,
            }, children: [cfg.heading && _jsx("h2", { children: cfg.heading }), !viewID && !configuration && !initial && _jsx("p", { children: "Choose a Saved View in the inspector." }), (cfg.search || cfg.filters) && (_jsxs("div", { className: "cv-controls", children: [cfg.search && (_jsxs("label", { children: ["Search", _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search content\u2026" })] })), cfg.filters && (_jsxs(_Fragment, { children: [_jsxs("label", { hidden: !categoriesEnabled, children: ["Category", _jsxs("select", { value: category, onChange: (e) => setCategory(e.target.value), children: [_jsx("option", { value: "", children: "All categories" }), categories.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] })] }), _jsxs("label", { children: ["Tag", _jsxs("select", { value: tag, onChange: (e) => setTag(e.target.value), children: [_jsx("option", { value: "", children: "All tags" }), tags.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] })] })] }))] })), calendar && (_jsxs("nav", { className: "cv-controls", "aria-label": "Calendar navigation", children: [_jsx("button", { type: "button", onClick: () => moveDate(-1), "aria-label": "Previous period", children: "\u2190" }), _jsx("button", { type: "button", onClick: () => setAnchor(new Date()), children: "Today" }), _jsx("strong", { children: rangeStart.toLocaleDateString(undefined, {
                                month: 'long',
                                year: 'numeric',
                                timeZone: 'UTC',
                            }) }), _jsx("button", { type: "button", onClick: () => moveDate(1), "aria-label": "Next period", children: "\u2192" }), layout === 'event-calendar' && (_jsxs("label", { children: ["View", _jsx("select", { "aria-label": "Calendar view", value: mode, onChange: (e) => setMode(e.target.value), children: ['month', 'week', 'day', 'year'].map((m) => (_jsx("option", { children: m }, m))) })] }))] })), busy && _jsx("p", { role: "status", children: "Loading\u2026" }), error && (_jsxs("p", { role: "alert", children: [error, ' ', _jsx("button", { type: "button", onClick: () => setRefresh((v) => v + 1), children: "Retry" })] })), !busy && !error && !items.length && (_jsxs("p", { children: ["No matching ", eventLayouts.some((l) => layout === `event-${l}`) ? 'events' : 'content', ' ', "found."] })), CustomRenderer && result ? (_jsx(CustomRenderer, { result: result, onSelect: open })) : calendar ? (layout === 'event-timetable' || activeMode === 'week' || activeMode === 'day' ? (_jsx("div", { className: "cv-timetable-scroll", children: _jsxs("div", { className: "cv-timetable", style: { '--cv-days': days }, children: [_jsx("div", { className: "cv-hours", "aria-hidden": "true", children: Array.from({ length: 24 }, (_, h) => (_jsxs("span", { style: { top: `${h * 48}px` }, children: [String(h).padStart(2, '0'), ":00"] }, h))) }), Array.from({ length: days }, (_, d) => {
                                const date = new Date(rangeStart.getTime() + d * 86400000), key = date.toISOString().slice(0, 10);
                                const start = eventInstant(key, zone, false), end = eventInstant(new Date(date.getTime() + 86400000).toISOString().slice(0, 10), zone, false);
                                const matching = items.filter((item) => item.occurrence &&
                                    Date.parse(item.occurrence.start) < end &&
                                    Date.parse(item.occurrence.end) > start);
                                const minutes = (instant) => {
                                    const parts = new Intl.DateTimeFormat('en', {
                                        timeZone: zone,
                                        hour: 'numeric',
                                        minute: 'numeric',
                                        hourCycle: 'h23',
                                    }).formatToParts(instant);
                                    return (Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
                                        Number(parts.find((p) => p.type === 'minute')?.value));
                                };
                                const timed = matching.filter((item) => !item.occurrence.allDay);
                                const lanes = occurrenceLanes(timed);
                                return (_jsxs("section", { className: "cv-time-day", children: [_jsx("h3", { children: date.toLocaleDateString(undefined, {
                                                weekday: 'short',
                                                day: 'numeric',
                                                timeZone: 'UTC',
                                            }) }), _jsx("div", { className: "cv-all-day", children: matching
                                                .filter((item) => item.occurrence.allDay)
                                                .map((item) => (_jsxs("button", { type: "button", onClick: () => open(item), children: [item.title, " \u00B7 All day"] }, item.id))) }), _jsx("div", { className: "cv-time-track", children: timed.map((item) => {
                                                const first = Date.parse(item.occurrence.start), last = Date.parse(item.occurrence.end);
                                                const top = first <= start ? 0 : minutes(first), bottom = last >= end ? 1440 : minutes(last);
                                                const placement = lanes.get(item.id);
                                                return (_jsxs("button", { type: "button", className: "cv-time-event", style: {
                                                        top: `${top * 0.8}px`,
                                                        height: `${Math.max(24, (bottom - top) * 0.8)}px`,
                                                        left: `${(placement.lane * 100) / placement.lanes}%`,
                                                        width: `${100 / placement.lanes}%`,
                                                    }, onClick: () => open(item), "aria-label": `${item.title}, ${format(item.occurrence.start)}`, children: [_jsx("time", { children: format(item.occurrence.start).split(', ').at(-1) }), _jsx("strong", { children: item.title })] }, item.id));
                                            }) })] }, key));
                            })] }) })) : activeMode === 'year' ? (_jsx("div", { className: "cv-year", children: Array.from({ length: 12 }, (_, m) => (_jsxs("section", { children: [_jsx("h3", { children: new Date(Date.UTC(localAnchor.getUTCFullYear(), m, 1)).toLocaleDateString(undefined, {
                                    month: 'long',
                                    timeZone: 'UTC',
                                }) }), _jsxs("div", { className: "cv-calendar", children: [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (_jsx("span", { className: "cv-weekday", children: day }, day))), Array.from({
                                        length: new Date(Date.UTC(localAnchor.getUTCFullYear(), m, 1)).getUTCDay(),
                                    }, (_, i) => (_jsx("span", { "aria-hidden": "true" }, `empty-${i}`))), Array.from({
                                        length: new Date(Date.UTC(localAnchor.getUTCFullYear(), m + 1, 0)).getUTCDate(),
                                    }, (_, d) => dayCell(new Date(Date.UTC(localAnchor.getUTCFullYear(), m, d + 1))))] })] }, m))) })) : (_jsxs("div", { className: `cv-calendar cv-calendar-${activeMode}`, children: [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (_jsx("span", { className: "cv-weekday", children: day }, day))), activeMode === 'month' &&
                            Array.from({ length: rangeStart.getUTCDay() }, (_, i) => (_jsx("div", { "aria-hidden": "true" }, `blank-${i}`))), Array.from({ length: days }, (_, d) => dayCell(new Date(rangeStart.getTime() + d * 86400000)))] }))) : layout === 'event-map' ? (_jsxs("div", { className: "cv-map", children: [_jsx("div", { children: items.map((item, i) => (_jsxs("div", { children: [_jsx("button", { type: "button", onClick: () => setSlide(i), "aria-pressed": slide === i, children: item.title }), card(item, i)] }, item.id))) }), items[slide]?.latitude !== undefined && items[slide]?.longitude !== undefined ? (_jsx("iframe", { title: `Map: ${items[slide].title}`, loading: "lazy", src: `https://www.openstreetmap.org/export/embed.html?bbox=${items[slide].longitude - 0.03},${items[slide].latitude - 0.03},${items[slide].longitude + 0.03},${items[slide].latitude + 0.03}&layer=mapnik&marker=${items[slide].latitude},${items[slide].longitude}` })) : (_jsx("p", { children: "Select an event with map coordinates. Map data \u00A9 OpenStreetMap contributors." }))] })) : layout === 'taxonomy' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "cv-taxonomy-grid", children: categoriesEnabled && categories.map((c) => (_jsx("button", { type: "button", onClick: () => setCategory(c.id), children: c.name }, c.id))) }), category && _jsx("div", { className: "cv-items", children: items.map(card) })] })) : layout === 'event-countdown' ? (_jsx(_Fragment, { children: items[0] && (_jsxs(_Fragment, { children: [_jsx(Countdown, { instant: items[0].occurrence.start }), card(items[0], 0)] })) })) : isSlider ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "cv-slides", "aria-live": "polite", children: items
                                .slice(Math.min(slide, Math.max(0, items.length - 1)), Math.min(slide, Math.max(0, items.length - 1)) +
                                (layout === 'event-carousel' ? 3 : 1))
                                .map(card) }), _jsxs("nav", { className: "cv-controls", "aria-label": "Slide navigation", children: [_jsx("button", { type: "button", disabled: slide === 0, onClick: () => setSlide((s) => s - 1), children: "Previous" }), _jsxs("span", { children: [items.length ? slide + 1 : 0, " / ", items.length] }), _jsx("button", { type: "button", disabled: slide >= items.length - 1, onClick: () => setSlide((s) => s + 1), children: "Next" })] })] })) : (_jsx("div", { className: "cv-items", children: (layout === 'event-single' || layout === 'event-cover'
                        ? items.slice(0, 1)
                        : items).map(card) })), !calendar && result && result.totalPages > 1 && cfg.pagination !== 'none' && (_jsx("nav", { className: "cv-controls", "aria-label": "Content pagination", children: cfg.pagination === 'more' ? (_jsx("button", { type: "button", disabled: busy || page >= result.totalPages, onClick: () => {
                            append.current = true;
                            setPage((p) => p + 1);
                        }, children: "Load more" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: busy || page === 1, onClick: () => setPage((p) => p - 1), children: "Previous" }), cfg.pagination === 'numbers' ? (Array.from({ length: Math.min(7, result.totalPages) }, (_, i) => Math.max(1, Math.min(page - 3, result.totalPages - 6)) + i).map((p) => (_jsx("button", { type: "button", "aria-current": p === page ? 'page' : undefined, disabled: busy, onClick: () => setPage(p), children: p }, p)))) : (_jsxs("span", { children: ["Page ", page, " of ", result.totalPages] })), _jsx("button", { type: "button", disabled: busy || page >= result.totalPages, onClick: () => setPage((p) => p + 1), children: "Next" })] })) })), _jsx("dialog", { ref: dialog, className: "cv-dialog", onCancel: (e) => {
                        e.preventDefault();
                        close();
                    }, onClick: (e) => {
                        if (e.target === dialog.current)
                            close();
                    }, children: selected && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: close, autoFocus: true, "aria-label": "Close event details", children: "\u00D7" }), _jsx("h2", { children: selected.title }), selected.occurrence && (_jsxs("p", { children: [format(selected.occurrence.start), " \u2013 ", format(selected.occurrence.end), " (", selected.occurrence.timezone, ")"] })), _jsx("p", { children: selected.location }), _jsx("p", { children: selected.excerpt }), _jsx("a", { href: selected.url, children: "Open full page" })] })) })] }) }));
}
function Countdown({ instant }) {
    const [now, setNow] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.floor((Date.parse(instant) - now) / 1000));
    return (_jsx("p", { className: "cv-countdown", role: "timer", "aria-label": "Time until event", children: !now
            ? 'Loading countdown…'
            : seconds
                ? `${Math.floor(seconds / 86400)} days ${Math.floor((seconds % 86400) / 3600)} hours ${Math.floor((seconds % 3600) / 60)} minutes ${seconds % 60} seconds`
                : 'This event has started.' }));
}
