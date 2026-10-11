// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  EditorDevices,
  EditorHeaderPortal,
  EditorHistory,
  EditorHistorySlot,
  EditorTitleSlot,
} from './EditorHeader'

vi.mock('@payloadcms/ui', () => ({ useDocumentInfo: () => ({ collectionSlug: 'posts', id: 42 }) }))
afterEach(cleanup)

it('renders history in its header slot, reflects availability, and removes it on unmount', async () => {
  const undo = vi.fn()
  const view = render(
    <>
      <ul>
        <EditorHistorySlot />
      </ul>
      <section>
        <EditorHistory undo={undo} redo={vi.fn()} canUndo canRedo={false} />
      </section>
    </>,
  )
  await waitFor(() => expect(document.querySelector('li button')).toBeTruthy())
  expect(within(document.querySelector('section')!).queryByRole('button')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(true)
  view.rerender(
    <ul>
      <EditorHistorySlot />
    </ul>,
  )
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('isolates document drawers even when the same document is open twice', async () => {
  render(
    <>
      <EditorTitleSlot />
      <EditorHeaderPortal slot="title">
        <input aria-label="Outer title" />
      </EditorHeaderPortal>
      <div role="dialog">
        <EditorTitleSlot />
        <EditorHeaderPortal slot="title">
          <input aria-label="Drawer title" />
        </EditorHeaderPortal>
      </div>
    </>,
  )
  await waitFor(() =>
    expect(document.querySelectorAll('[data-editor-slot="title"] input').length).toBe(2),
  )
  expect(within(screen.getByRole('dialog')).queryByLabelText('Outer title')).toBeNull()
  expect(within(screen.getByRole('dialog')).getByLabelText('Drawer title')).toBeTruthy()
})

it('uses accessible device icons and only changes preview state', () => {
  const change = vi.fn()
  render(<EditorDevices value="tablet" onChange={change} />)
  expect(screen.getByRole('button', { name: 'Tablet' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Phone' }))
  expect(change).toHaveBeenCalledExactlyOnceWith('mobile')
})
