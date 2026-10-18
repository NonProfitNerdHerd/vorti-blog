'use client'
import { useSiteFormat } from '../SiteFormatContext'
import { formatSiteDate, formatSiteTime } from '../site-format'
import React, { useEffect, useState } from 'react'
import { zonedParts } from './dates'
import type { FormField } from './model'

export interface BookingOption { id: string; startsAt: string; endsAt: string; remaining: number }
export interface BookingSelection { token: string; expiresAt: string; startsAt: string; endsAt: string; slot: string }
export interface BookingAdapter {
  load: (field: FormField, from: string, to: string) => Promise<BookingOption[]>
  reserve: (field: FormField, path: string, slot: string) => Promise<BookingSelection>
  release: (field: FormField, path: string) => Promise<void>
  selected?: (path: string) => BookingSelection | undefined
}
export function BookingInput({ field, path, id, value, disabled, adapter, onChange }: {
  field: FormField; path: string; id: string; value?: string; disabled?: boolean; adapter?: BookingAdapter; onChange: (value: string) => void
}) {
  const siteFormat = useSiteFormat()
  const [day, setDay] = useState(() => zonedParts(value ? new Date(value) : new Date(), field.date?.timezone || 'UTC').slice(0, 10))
  const [slots, setSlots] = useState<BookingOption[]>([]), [loaded, setLoaded] = useState(''), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(''), [expires, setExpires] = useState(() => adapter?.selected?.(path)?.expiresAt || ''), [refresh, setRefresh] = useState(0)
  const query = `${field.id}:${field.date?.resource}:${field.date?.timezone}:${day}:${refresh}`, loading = loaded !== query
  useEffect(() => {
    if (!adapter || !/^\d{4}-\d\d-\d\d$/.test(day)) return
    let canceled = false
    const center = Date.parse(`${day}T00:00:00Z`)
    if (!Number.isFinite(center)) return
    adapter.load(field, new Date(center - 86400000).toISOString(), new Date(center + 2 * 86400000).toISOString()).then(options => {
      if (!canceled) { setSlots(options.filter(slot => zonedParts(new Date(slot.startsAt), field.date?.timezone || 'UTC').startsWith(day))); setMessage('') }
    }).catch(error => { if (!canceled) setMessage((error as Error).message) }).finally(() => { if (!canceled) setLoaded(query) })
    return () => { canceled = true }
  }, [adapter, day, field, query])
  useEffect(() => {
    if (!expires) return
    const delay = Date.parse(expires) - Date.now()
    const timer = setTimeout(() => { setMessage('This hold expired. Choose an available time again before submitting.'); setExpires(''); setRefresh(n => n + 1) }, Math.max(0, delay))
    return () => clearTimeout(timer)
  }, [expires])
  if (!adapter) return <p>Available times appear on the published form. This preview does not reserve capacity.</p>
  return <div>
    <input id={id} type="date" value={day} disabled={disabled || busy} onChange={event => setDay(event.target.value)} aria-describedby={`${id}-booking-help`} />
    <p id={`${id}-booking-help`}>Choose an available time in {field.date?.timezone || 'UTC'}. A temporary hold is confirmed when you submit.</p>
    <div role="group" aria-label={`${field.label} available times`}>
      {(!loading ? slots : []).map(slot => <button type="button" key={slot.id} disabled={disabled || busy || !!expires && value === slot.startsAt} aria-pressed={!!expires && value === slot.startsAt} onClick={async () => {
        setBusy(true)
        try { const selected = await adapter.reserve(field, path, slot.id); onChange(selected.startsAt); setExpires(selected.expiresAt); setMessage(`Held until ${formatSiteTime(selected.expiresAt, siteFormat, field.date?.timezone || 'UTC')}. Submit to confirm your place.`) }
        catch (error) { setMessage((error as Error).message); setRefresh(n => n + 1) }
        finally { setBusy(false) }
      }}>{formatSiteTime(slot.startsAt, siteFormat, field.date?.timezone || 'UTC')} · {slot.remaining} available</button>)}
    </div>
    {loading ? <p role="status">Checking available times…</p> : !slots.length && <p>No times are available on this date. Try another day.</p>}
    {value && <p>Selected: {`${formatSiteDate(value, siteFormat, field.date?.timezone || 'UTC')} ${formatSiteTime(value, siteFormat, field.date?.timezone || 'UTC')}`} {!expires && '— reserve again before submitting'}</p>}
    {value && <button type="button" disabled={disabled || busy} onClick={async () => { setBusy(true); try { await adapter.release(field, path); onChange(''); setExpires(''); setRefresh(n => n + 1) } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }}>Release selected time</button>}
    <button type="button" disabled={disabled || busy || loading} onClick={() => setRefresh(n => n + 1)}>Refresh availability</button>
    <p role="status">{message}</p>
  </div>
}
