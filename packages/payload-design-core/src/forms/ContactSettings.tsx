import React from 'react'
import type { FormField } from './model'
import { contactComponents } from './contact'
import { WidthControl } from './WidthControl'

export function ContactSettings({ field, update }: { field: FormField; update: (patch: Partial<FormField>) => void }) {
  if (!['name', 'phone', 'address'].includes(field.kind)) return null
  const options = field.kind === 'name' ? [['full', 'Full name'], ['firstLast', 'First and Last'], ['middleInitial', 'First, Middle Initial, and Last'], ['middle', 'First, Middle, and Last']] : [['us', 'US'], ['international', 'International']]
  return <section><label>{field.kind === 'name' ? 'Name layout' : field.kind === 'phone' ? 'Phone format' : 'Address format'}<select aria-label={field.kind === 'name' ? 'Name layout' : field.kind === 'phone' ? 'Phone format' : 'Address format'} value={field.contact?.format || ''} onChange={event => update({ contact: { ...field.contact, format: event.target.value as NonNullable<FormField['contact']>['format'] } })}><option value="" disabled>Existing format (unchanged)</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{field.kind === 'address' && field.contact?.format === 'us' && <label><input type="checkbox" checked={field.contact.line2 || false} onChange={event => update({ contact: { ...field.contact!, line2: event.target.checked } })} />Show Address Line 2</label>}<p>Select an input in Build or expand this part in List View to adjust its label and width. Existing answers are never rewritten.</p></section>
}
export function ComponentSettings({ field, component, update, disabled }: { field: FormField; component: string; update: (patch: Partial<FormField>) => void; disabled?: boolean }) {
  const part = contactComponents(field).find(item => item.key === component)
  if (!part) return <p>This component is not used by the selected format.</p>
  const apply = (patch: NonNullable<FormField['components']>[string]) => update({ components: { ...field.components, [component]: { ...field.components?.[component], ...patch } } })
  return <fieldset disabled={disabled}><legend>{part.label}</legend><p>This input belongs to {field.blockLabel || field.label}. Its answer key stays {component}.</p><label>Input label<input value={part.label} onChange={event => apply({ label: event.target.value })} /></label><WidthControl value={part.widthFraction} onChange={widthFraction => apply({ widthFraction })} disabled={disabled} /><label>Help text<textarea value={part.help || ''} onChange={event => apply({ help: event.target.value })} /></label><label>Placeholder<input value={part.placeholder || ''} onChange={event => apply({ placeholder: event.target.value })} /></label><button type="button" onClick={() => { const components = { ...field.components }; delete components[component]; update({ components }) }}>Reset input presentation</button></fieldset>
}
