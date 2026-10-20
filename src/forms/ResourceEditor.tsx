'use client'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import { useState, useSyncExternalStore } from 'react'
import type { JSONFieldClientComponent } from 'payload'
import { makeID, wallTimeToInstant, zonedParts } from '@design-system/payload-design-core/forms'
import type { ResourceSlot } from './resource-config'
import { useCollectionEditorAccess } from '../content-framework/useCollectionEditorAccess'
const subscribe = () => () => {}

export const ResourceEditor: JSONFieldClientComponent = ({ path, readOnly }) => {
  const { value = [], setValue, showError, errorMessage } = useField<ResourceSlot[]>({ path })
  const { value: timezone = 'UTC' } = useField<string>({ path: 'timezone' })
  const { value: defaultCapacity = 1 } = useField<number>({ path: 'capacity' })
  const { data } = useDocumentInfo(), access = useCollectionEditorAccess('form-resources', readOnly)
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [message, setMessage] = useState('')
  const [duration, setDuration] = useState(30), [fold, setFold] = useState<'earlier' | 'later' | 'reject'>('reject')
  const saved = new Set(((data?.availability || []) as ResourceSlot[]).map(slot => slot.id))
  const format = (value: string) => { try { return zonedParts(new Date(value), timezone).replace('T', ' ') } catch { return value } }
  return <section className="forms-builder"><h3>Available times</h3><p>Generate slots in {timezone}. Each slot has its own capacity. Saved times keep their identity; remove a time from availability to stop new reservations while retaining its history.</p>
    {showError && <p role="alert">{String(errorMessage)}</p>}
    <fieldset disabled={!hydrated || !access.canWrite(path)}><legend>Add available times</legend>
      <label>From<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>Until<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <label>Slot length (minutes)<input type="number" min={1} max={1440} value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
      <label>When clocks repeat a time<select value={fold} onChange={event => setFold(event.target.value as typeof fold)}><option value="reject">Ask me to choose</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>
      <button type="button" onClick={() => {
        try {
          const first = Date.parse(wallTimeToInstant(start, timezone, fold)), last = Date.parse(wallTimeToInstant(end, timezone, fold)), increment = duration * 60000
          if (!Number.isInteger(duration) || duration < 1 || duration > 1440 || last <= first || value.length + Math.ceil((last - first) / increment) > 500) throw new Error('Choose chronological times, a slot length of 1–1440 minutes, and no more than 500 slots.')
          const slots: ResourceSlot[] = []
          for (let time = first; time + increment <= last; time += increment) slots.push({ id: makeID('slot'), startsAt: new Date(time).toISOString(), endsAt: new Date(time + increment).toISOString(), capacity: defaultCapacity || 1 })
          if (!slots.length) throw new Error('The interval must contain at least one whole slot.')
          setValue([...value, ...slots]); setMessage(`${slots.length} slots added. Save this resource to make them available.`)
        } catch (error) { setMessage((error as Error).message) }
      }}>Generate slots</button>
      <p role="status">{message}</p>
      <ol>{value.map((slot, index) => <li key={slot.id}><p>{format(slot.startsAt)} – {format(slot.endsAt)}{saved.has(slot.id) && ' · Saved time'}</p>
        <label>Places for slot {index + 1}<input type="number" min={1} max={1000} value={slot.capacity} onChange={event => setValue(value.map(item => item.id === slot.id ? { ...item, capacity: Number(event.target.value) } : item))} /></label>
        <button type="button" onClick={() => setValue(value.filter(item => item.id !== slot.id))}>Remove slot {index + 1} from availability</button>
      </li>)}</ol>
    </fieldset>
  </section>
}
