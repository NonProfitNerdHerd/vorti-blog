'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSiteFormat } from '../SiteFormatContext.js';
import { formatSiteDate, formatSiteTime } from '../site-format.js';
import { useEffect, useState } from 'react';
import { zonedParts } from './dates.js';
export function BookingInput({ field, path, id, value, disabled, adapter, onChange }) {
    const siteFormat = useSiteFormat();
    const [day, setDay] = useState(() => zonedParts(value ? new Date(value) : new Date(), field.date?.timezone || 'UTC').slice(0, 10));
    const [slots, setSlots] = useState([]), [loaded, setLoaded] = useState(''), [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(''), [expires, setExpires] = useState(() => adapter?.selected?.(path)?.expiresAt || ''), [refresh, setRefresh] = useState(0);
    const query = `${field.id}:${field.date?.resource}:${field.date?.timezone}:${day}:${refresh}`, loading = loaded !== query;
    useEffect(() => {
        if (!adapter || !/^\d{4}-\d\d-\d\d$/.test(day))
            return;
        let canceled = false;
        const center = Date.parse(`${day}T00:00:00Z`);
        if (!Number.isFinite(center))
            return;
        adapter.load(field, new Date(center - 86400000).toISOString(), new Date(center + 2 * 86400000).toISOString()).then(options => {
            if (!canceled) {
                setSlots(options.filter(slot => zonedParts(new Date(slot.startsAt), field.date?.timezone || 'UTC').startsWith(day)));
                setMessage('');
            }
        }).catch(error => { if (!canceled)
            setMessage(error.message); }).finally(() => { if (!canceled)
            setLoaded(query); });
        return () => { canceled = true; };
    }, [adapter, day, field, query]);
    useEffect(() => {
        if (!expires)
            return;
        const delay = Date.parse(expires) - Date.now();
        const timer = setTimeout(() => { setMessage('This hold expired. Choose an available time again before submitting.'); setExpires(''); setRefresh(n => n + 1); }, Math.max(0, delay));
        return () => clearTimeout(timer);
    }, [expires]);
    if (!adapter)
        return _jsx("p", { children: "Available times appear on the published form. This preview does not reserve capacity." });
    return _jsxs("div", { children: [_jsx("input", { id: id, type: "date", value: day, disabled: disabled || busy, onChange: event => setDay(event.target.value), "aria-describedby": `${id}-booking-help` }), _jsxs("p", { id: `${id}-booking-help`, children: ["Choose an available time in ", field.date?.timezone || 'UTC', ". A temporary hold is confirmed when you submit."] }), _jsx("div", { role: "group", "aria-label": `${field.label} available times`, children: (!loading ? slots : []).map(slot => _jsxs("button", { type: "button", disabled: disabled || busy || !!expires && value === slot.startsAt, "aria-pressed": !!expires && value === slot.startsAt, onClick: async () => {
                        setBusy(true);
                        try {
                            const selected = await adapter.reserve(field, path, slot.id);
                            onChange(selected.startsAt);
                            setExpires(selected.expiresAt);
                            setMessage(`Held until ${formatSiteTime(selected.expiresAt, siteFormat, field.date?.timezone || 'UTC')}. Submit to confirm your place.`);
                        }
                        catch (error) {
                            setMessage(error.message);
                            setRefresh(n => n + 1);
                        }
                        finally {
                            setBusy(false);
                        }
                    }, children: [formatSiteTime(slot.startsAt, siteFormat, field.date?.timezone || 'UTC'), " \u00B7 ", slot.remaining, " available"] }, slot.id)) }), loading ? _jsx("p", { role: "status", children: "Checking available times\u2026" }) : !slots.length && _jsx("p", { children: "No times are available on this date. Try another day." }), value && _jsxs("p", { children: ["Selected: ", `${formatSiteDate(value, siteFormat, field.date?.timezone || 'UTC')} ${formatSiteTime(value, siteFormat, field.date?.timezone || 'UTC')}`, " ", !expires && '— reserve again before submitting'] }), value && _jsx("button", { type: "button", disabled: disabled || busy, onClick: async () => { setBusy(true); try {
                    await adapter.release(field, path);
                    onChange('');
                    setExpires('');
                    setRefresh(n => n + 1);
                }
                catch (error) {
                    setMessage(error.message);
                }
                finally {
                    setBusy(false);
                } }, children: "Release selected time" }), _jsx("button", { type: "button", disabled: disabled || busy || loading, onClick: () => setRefresh(n => n + 1), children: "Refresh availability" }), _jsx("p", { role: "status", children: message })] });
}
