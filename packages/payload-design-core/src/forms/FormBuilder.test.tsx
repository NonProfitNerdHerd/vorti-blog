// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FormBuilder } from './FormBuilder'
import { FormRenderer } from './FormRenderer'
import { emptyDefinition } from './model'

afterEach(cleanup)

it('captures the legacy internal label when its public question changes', () => {
  let latest = { ...emptyDefinition(), fields: [{ id: 'old', kind: 'text', label: 'Old question' }] }
  function Editor() { const [value, setValue] = React.useState(latest); return <FormBuilder value={value} onChange={next => { latest = next; setValue(next) }} /> }
  render(<Editor />)
  fireEvent.click(screen.getByRole('group', { name: 'Old question Single-line text' }))
  fireEvent.change(screen.getByLabelText('Question / label'), { target: { value: 'A longer question for respondents' } })
  expect(latest.fields[0]).toMatchObject({ label: 'A longer question for respondents', blockLabel: 'Old question' })
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
  expect(latest.fields[1]).toMatchObject({ label: 'A longer question for respondents', blockLabel: 'Old question copy' })
  expect(latest.fields[1].id).not.toBe('old')
})

it('filters empty palette categories and selects clean choice parts for inspector editing', () => {
  function Editor() {
    const [value, setValue] = React.useState(emptyDefinition())
    return <FormBuilder value={value} onChange={setValue} />
  }
  const { container } = render(<Editor />)
  fireEvent.click(screen.getByRole('tab', { name: 'Add Parts' }))
  fireEvent.change(screen.getByLabelText('Search parts'), { target: { value: 'Can' } })
  expect(screen.queryByRole('heading', { name: 'Basic' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Layout' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Canvas' }).querySelector('[data-part-icon="step"]')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Search parts'), { target: { value: 'Dropdown' } })
  fireEvent.click(screen.getByRole('button', { name: 'Dropdown' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Choices' }))
  fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Updated choice' } })
  expect(within(screen.getByRole('main', { name: 'Form canvas' })).getByText('Updated choice')).toBeTruthy()
  expect(container.querySelector('.forms-canvas-card-title')).toBeNull()
  expect(screen.queryByLabelText(/^Drag /)).toBeNull()
})

it('inserts real columns and switches layouts without losing nested fields', () => {
  function Editor() {
    const [value, setValue] = React.useState(emptyDefinition())
    return <FormBuilder value={value} onChange={setValue} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('tab', { name: 'Add Parts' }))
  fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
  const chooser = screen.getByRole('region', { name: 'Select a column layout' })
  fireEvent.click(within(chooser).getByRole('button', { name: '70/30 columns' }))
  expect(screen.queryByRole('region', { name: 'Select a column layout' })).toBeNull()
  expect(screen.getByRole('main', { name: 'Form canvas' }).querySelectorAll('.forms-editor-columns > .forms-part-slot')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '100 columns' }))
  expect(screen.getByRole('main', { name: 'Form canvas' }).querySelectorAll('.forms-editor-columns > .forms-part-slot')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Undo form change' }))
  expect(screen.getByRole('main', { name: 'Form canvas' }).querySelectorAll('.forms-editor-columns > .forms-part-slot')).toHaveLength(2)
})

it('keeps read-only construction and import disabled while allowing tab navigation and export', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  try {
    render(<FormBuilder value={emptyDefinition()} onChange={() => { throw new Error('Unexpected edit') }} readOnly transferTarget={host} emailTarget={host} />)
    expect((screen.getByRole('button', { name: 'Add first Canvas' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Add Parts' }))
    expect((screen.getByRole('button', { name: 'Single-line text' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(host).getByLabelText('Add email notification').closest('fieldset')?.disabled).toBe(true)
    expect((within(host).getByLabelText('Import JSON file') as HTMLInputElement).disabled).toBe(true)
    expect((within(host).getByRole('button', { name: 'Export definition' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.getByRole('heading', { name: 'Publish readiness' })).toBeTruthy()
  } finally { host.remove() }
})

it('renders descendants of a disabled group as visible disabled controls', () => {
  const definition = emptyDefinition()
  definition.fields = [{ id: 'group', kind: 'section', label: 'Group 1', disabled: true, children: [
    { id: 'question', kind: 'text', label: 'Question' },
  ] }]
  render(<FormRenderer definition={definition} preview />)
  const input = screen.getByLabelText('Question') as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(input.closest('fieldset')?.disabled).toBe(true)
})

it('keeps email changes in the shared history without changing other actions', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const definition = emptyDefinition()
  definition.actions = [{ id: 'hook', kind: 'webhook', name: 'Existing webhook', config: {} }, { id: 'mail', kind: 'email', name: 'Notice', config: { to: 'owner@example.test', subject: 'Old subject' } }]
  function Editor() {
    const [value, setValue] = React.useState(definition)
    return <FormBuilder value={value} onChange={setValue} emailTarget={host} />
  }
  try {
    render(<Editor />)
    fireEvent.change(within(host).getByLabelText('Subject'), { target: { value: 'Changed subject' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }))
    expect(screen.getByDisplayValue('Existing webhook')).toBeTruthy()
    expect(within(host).getByDisplayValue('Changed subject')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo form change' }))
    expect(within(host).getByDisplayValue('Old subject')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Redo form change' }))
    expect(within(host).getByDisplayValue('Changed subject')).toBeTruthy()
    expect(screen.getByDisplayValue('Existing webhook')).toBeTruthy()
  } finally { host.remove() }
})
it('shares controlled navigation and a header toolbar without mounting duplicate tabs', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  function Editor() {
    const [value, setValue] = React.useState(emptyDefinition())
    const [view, onChange] = React.useState('Build')
    return <><button onClick={() => onChange('Design')}>Open Design</button><output>{view}</output><FormBuilder value={value} onChange={setValue} navigation={{ view, onChange }} toolbarTarget={host} /></>
  }
  try {
    render(<Editor />)
    expect(screen.queryByRole('tablist', { name: 'Form settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add first Canvas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Design' }))
    fireEvent.click(within(host).getByRole('button', { name: 'Try form' }))
    expect(screen.getByText('Preview')).toBeTruthy()
    fireEvent.click(within(host).getByRole('button', { name: 'Return to builder' }))
    expect(screen.getByLabelText('Submit button label')).toBeTruthy()
    fireEvent.click(within(host).getByRole('button', { name: 'Undo form change' }))
    fireEvent.click(within(host).getByRole('button', { name: 'Redo form change' }))
    fireEvent.click(within(host).getByRole('button', { name: 'Publish' }))
    expect(screen.getByRole('heading', { name: 'Publish readiness' })).toBeTruthy()
  } finally { host.remove() }
})
