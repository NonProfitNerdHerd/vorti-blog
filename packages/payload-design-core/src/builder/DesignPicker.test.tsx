// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesignPicker, orderedDesigns } from './DesignPicker'

afterEach(cleanup)
const designs = [{ id: 3, name: 'Split', blockType: 7 }, { id: 2, name: 'Classic', blockType: 7 }, { id: 1, name: 'Classic', blockType: 7 }, { id: 4, name: 'Other', blockType: 8 }]
it('sorts only the selected type deterministically without changing the input', () => {
  expect(orderedDesigns(designs, 7).map(d => d.id)).toEqual([1, 2, 3])
  expect(designs[0].id).toBe(3)
})
it('supports keyboard movement, selection and Skip without applying another design', () => {
  const change = vi.fn(), done = vi.fn()
  render(<DesignPicker designs={designs.slice(0, 2)} value={2} onChange={change} onDone={done} />)
  const split = screen.getByRole('button', { name: 'Split' })
  split.focus()
  fireEvent.keyDown(split, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Classic' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(split)
  expect(change).toHaveBeenCalledWith(3)
  expect(done).toHaveBeenCalledTimes(2)
})
it('provides a recovery link rather than a selectable invalid design', () => {
  render(<DesignPicker designs={[]} onChange={vi.fn()} />)
  expect(screen.getByRole('link', { name: 'Open Block Creator' }).getAttribute('href')).toBe('/admin/collections/design-block-types')
  expect(screen.queryByRole('button')).toBeNull()
})
