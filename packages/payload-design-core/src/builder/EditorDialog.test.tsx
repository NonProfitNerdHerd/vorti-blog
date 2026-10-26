// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorDialog } from './EditorDialog'
import { InspectorTabs } from './InspectorTabs'
import { InspectorToggle, Popover } from './InspectorControls'

afterEach(cleanup)

it('leaves keyboard events to an external media or relationship drawer', () => {
  render(
    <>
      <Harness />
      <div role="dialog" aria-label="Media drawer">
        <input aria-label="Media search" />
      </div>
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }))
  const input = screen.getByLabelText('Media search')
  input.focus()
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByRole('dialog', { name: 'Block settings' })).toBeTruthy()
})

it('lets the dialog handle Escape without closing the inspector sidebar', () => {
  const change = vi.fn()
  render(
    <>
      <InspectorToggle open change={change} />
      <Harness />
    </>,
  )
  vi.spyOn(
    screen.getByRole('button', { name: 'Toggle inspector' }),
    'getClientRects',
  ).mockReturnValue([{}] as unknown as DOMRectList)
  fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close dialog' }), { key: 'Escape' })
  expect(change).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

function Harness({ seo = false }: { seo?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'block' | 'document' | 'seo'>('block')
  return (
    <EditorDialog inline open={open} title={seo && tab === 'seo' ? 'SEO settings' : 'Block settings'} onClose={() => setOpen(false)}>
      <InspectorTabs
        seo={seo}
        value={tab}
        onChange={setTab}
        documentLabel="Post"
        onExpand={() => setOpen(true)}
      />
      <input aria-label="Draft setting" defaultValue="Original" />
      <Popover label="Color picker" trigger="Color">
        <input aria-label="Color value" />
      </Popover>
    </EditorDialog>
  )
}

it('preserves mounted inputs and tabs while expanding and closing, and restores focus', async () => {
  render(<Harness />)
  const input = screen.getByLabelText('Draft setting')
  fireEvent.change(input, { target: { value: 'Unsaved change' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Document settings' }))
  const expand = screen.getByRole('button', { name: 'Expand inspector' })
  expand.focus()
  fireEvent.click(expand)
  const dialog = screen.getByRole('dialog', { name: 'Block settings' })
  expect(within(dialog).getByLabelText('Draft setting')).toBe(input)
  expect(
    within(dialog).getByRole('tab', { name: 'Document settings' }).getAttribute('aria-selected'),
  ).toBe('true')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((input as HTMLInputElement).value).toBe('Unsaved change')
  expect(screen.getByLabelText('Draft setting')).toBe(input)
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand inspector' })),
  )
})

it('keeps color popovers inside the expanded inspector and dismisses only the popover first', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }))
  const dialog = screen.getByRole('dialog', { name: 'Block settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Color picker' }))
  expect(dialog.contains(screen.getByRole('dialog', { name: 'Color picker' }))).toBe(true)
  fireEvent.keyDown(screen.getByLabelText('Color value'), { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Color picker' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Block settings' })).toBe(dialog)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('supports three SEO tabs, keyboard wrapping and the expanded SEO dialog without losing draft state', async () => {
  render(<Harness seo />)
  expect(screen.getAllByRole('tab')).toHaveLength(3)
  const input = screen.getByLabelText('Draft setting')
  fireEvent.change(input, { target: { value: 'Unsaved SEO title' } })
  fireEvent.click(screen.getByRole('tab', { name: 'SEO' }))
  screen.getByRole('button', { name: 'Expand inspector' }).focus()
  fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }))
  const dialog = screen.getByRole('dialog', { name: 'SEO settings' })
  expect(within(dialog).getByLabelText('Draft setting')).toBe(input)
  fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'SEO' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Block' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Block' }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: 'SEO' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'SEO' }), { key: 'Home' })
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Block' }), { key: 'End' })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close dialog' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByLabelText('Draft setting') as HTMLInputElement).value).toBe('Unsaved SEO title')
  expect(screen.getByRole('tab', { name: 'SEO' }).getAttribute('aria-selected')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand inspector' })))
})
