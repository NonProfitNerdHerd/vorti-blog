// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TypeFieldBuilder } from './TypeFieldBuilder'
afterEach(cleanup)

it('protects the sole capability field before first save', () => {
  render(
    <TypeFieldBuilder
      fields={[
        { id: 'schedule', label: 'Schedule', kind: 'eventSchedule', required: true, public: true },
      ]}
      onChange={vi.fn()}
      savedFields={[]}
      requiredKinds={['eventSchedule']}
      preview={null}
    />,
  )
  expect((screen.getByRole('button', { name: 'Remove field' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(screen.getByLabelText('Field type').hasAttribute('disabled')).toBe(true)
  expect((screen.getByLabelText('Required for publication') as HTMLInputElement).disabled).toBe(
    true,
  )
})

it('validates Save Field without requiring sample content', () => {
  const { rerender } = render(
    <TypeFieldBuilder
      fields={[{ id: 'bio', label: 'Biography', kind: 'text', required: true }]}
      onChange={vi.fn()}
      savedFields={[]}
      preview={null}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save Field' }))
  expect(screen.getByRole('status').textContent).toContain('Applied to setup')
  rerender(
    <TypeFieldBuilder
      fields={[{ id: 'bio', label: 'Biography', kind: 'text', rules: [{ kind: 'minLength' }] }]}
      onChange={vi.fn()}
      savedFields={[]}
      preview={null}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Update Field' }))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Field issues')
  expect(screen.getByRole('status').textContent).toBe('')
})
