'use client'
import { useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import { TypeValueForm } from './TypeValues'
import { eventFields } from './event-fields'

export const EventField: JSONFieldClientComponent = ({ path, readOnly }) => {
  const { value, setValue } = useField<Record<string, unknown> | null>({ path })
  return <section>
    <label><input type="checkbox" disabled={readOnly} checked={!!value} onChange={event => setValue(event.target.checked ? {} : null)} /> Include event information</label>
    {value && <TypeValueForm fields={eventFields} label="Event information" value={value} onChange={setValue} readOnly={readOnly} />}
  </section>
}
