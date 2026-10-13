'use client'
import React from 'react'
import { Trash2 } from 'lucide-react'
import type { DateRestrictions } from './model'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function DateSettings({ value = {}, kind, onChange, resources = [] }: { value?: DateRestrictions; kind: string; resources?: { id: string; label: string }[]; onChange: (value: DateRestrictions) => void }) {
  const change = (patch: Partial<DateRestrictions>) => onChange({ ...value, ...patch })
  const timed = kind === 'time' || kind === 'datetime'
  return <fieldset><legend>Date and availability</legend>
    <label>Timezone<input value={value.timezone || 'UTC'} onChange={event => change({ timezone: event.target.value })} placeholder="America/Chicago" /></label>
    <p><small>Calendar dates remain dates. Date/time values use this timezone, including clock changes.</small></p>
    {kind !== 'time' && <>
      <label>Earliest date<input type="date" value={value.min || ''} onChange={event => change({ min: event.target.value || undefined })} /></label>
      <label>Latest date<input type="date" value={value.max || ''} onChange={event => change({ max: event.target.value || undefined })} /></label>
      <label>Earliest: days from today<input type="number" step={1} value={value.minDaysFromToday ?? ''} onChange={event => change({ minDaysFromToday: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      <label>Latest: days from today<input type="number" step={1} value={value.maxDaysFromToday ?? ''} onChange={event => change({ maxDaysFromToday: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      <fieldset><legend>Unavailable weekdays</legend>{weekdays.map((day, index) => <label className="forms-builder-check" key={day}><input type="checkbox" checked={value.excludedWeekdays?.includes(index) || false} onChange={event => change({ excludedWeekdays: event.target.checked ? [...value.excludedWeekdays || [], index] : value.excludedWeekdays?.filter(item => item !== index) })} />{day}</label>)}</fieldset>
      <label>Blackout dates (one YYYY-MM-DD per line)<textarea value={value.blackoutDates?.join('\n') || ''} onChange={event => change({ blackoutDates: event.target.value.split('\n').filter(Boolean) })} /></label>
      <fieldset><legend>Available date ranges</legend><p><small>Leave empty to allow every date that passes the other restrictions.</small></p>{value.allowedRanges?.map((range, index) => <fieldset key={index}><legend>Range {index + 1}</legend>
        <label>From<input type="date" value={range.start} onChange={event => change({ allowedRanges: value.allowedRanges?.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })} /></label>
        <label>Through<input type="date" value={range.end} onChange={event => change({ allowedRanges: value.allowedRanges?.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })} /></label>
        <button type="button" aria-label={`Remove available range ${index + 1}`} onClick={() => change({ allowedRanges: value.allowedRanges?.filter((_, i) => i !== index) })}><Trash2 size={16} />Remove range</button>
      </fieldset>)}<button type="button" onClick={() => change({ allowedRanges: [...value.allowedRanges || [], { start: '', end: '' }] })}>Add available range</button></fieldset>
    </>}
    {kind === 'datetime' && <label>Minimum notice (minutes)<input type="number" min={0} value={value.leadMinutes ?? ''} onChange={event => change({ leadMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
    {timed && <>
      <label>Time increment (minutes)<input type="number" min={1} max={1440} step={1} value={value.incrementMinutes ?? ''} onChange={event => change({ incrementMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      <fieldset><legend>Business hours</legend>{kind === 'time' && <p><small>A time-only field accepts any configured time window. Use Date and time to also enforce its weekday.</small></p>}
        {value.businessHours?.map((hours, index) => <fieldset key={index}><legend>Hours {index + 1}</legend>
          <label>Weekday<select value={hours.weekday} onChange={event => change({ businessHours: value.businessHours?.map((item, i) => i === index ? { ...item, weekday: Number(event.target.value) } : item) })}>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
          <label>Opens<input type="time" value={hours.start} onChange={event => change({ businessHours: value.businessHours?.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })} /></label>
          <label>Closes<input type="time" value={hours.end} onChange={event => change({ businessHours: value.businessHours?.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })} /></label>
          <button type="button" aria-label={`Remove business hours ${index + 1}`} onClick={() => change({ businessHours: value.businessHours?.filter((_, i) => i !== index) })}><Trash2 size={16} />Remove hours</button>
        </fieldset>)}<button type="button" onClick={() => change({ businessHours: [...value.businessHours || [], { weekday: 1, start: '09:00', end: '17:00' }] })}>Add business hours</button>
      </fieldset>
    </>}
    {kind === 'datetime' && <label>Booking resource<select value={value.resource || ''} onChange={event => change({ resource: event.target.value || undefined })}><option value="">No reservation — author chooses any valid date/time</option>{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.label}</option>)}{value.resource && !resources.some(resource => resource.id === value.resource) && <option value={value.resource}>Unavailable resource ({value.resource})</option>}</select><small>Create and manage resources in Forms → Booking resources. Selecting a resource changes this field into an available-time picker.</small></label>}
  </fieldset>
}
