// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FormBuilder } from './FormBuilder'
import { FormRenderer } from './FormRenderer'
import { emptyDefinition } from './model'

afterEach(cleanup)

it('keeps read-only construction and import disabled while allowing tab navigation and export', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  try {
    render(<FormBuilder value={emptyDefinition()} onChange={() => { throw new Error('Unexpected edit') }} readOnly transferTarget={host} />)
    expect((screen.getByRole('button', { name: 'Add first group' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Single-line text' }) as HTMLButtonElement).disabled).toBe(true)
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
