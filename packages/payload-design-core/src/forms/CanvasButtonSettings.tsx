'use client'
import React from 'react'
import { canvasButtons } from './graph'
import { makeID, type FormDefinition, type FormField } from './model'
export function CanvasButtonSettings({ field, definition, onChange }: { field: FormField; definition: FormDefinition; onChange: (buttons: NonNullable<FormField['buttons']>) => void }) {
  const buttons = canvasButtons(definition, field.id)
  return <fieldset><legend>Canvas buttons</legend><p>These buttons are used when graph navigation is enabled in Logic.</p>{buttons.map(button => <div key={button.id}><label>Button label<input value={button.label} onChange={e => onChange(buttons.map(b => b.id === button.id ? { ...b, label: e.target.value } : b))} /></label><label>Button event<select value={button.event} onChange={e => onChange(buttons.map(b => b.id === button.id ? { ...b, event: e.target.value as typeof button.event } : b))}>{['next', 'back', 'submit', 'custom'].map(event => <option key={event}>{event}</option>)}</select></label><button type="button" onClick={() => onChange(buttons.filter(b => b.id !== button.id))}>Remove button</button></div>)}<button type="button" onClick={() => onChange([...buttons, { id: makeID('button'), label: 'New button', event: 'custom' }])}>Add button</button></fieldset>
}
