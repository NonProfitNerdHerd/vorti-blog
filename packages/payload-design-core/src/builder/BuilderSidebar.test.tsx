// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BuilderSidebar,
  SidebarControls,
  useBuilderSidebar,
  type SidebarAdapter,
} from './BuilderSidebar'

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn() }),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
}))
afterEach(cleanup)
function Harness({ adapter, identity = 'post' }: { adapter: SidebarAdapter; identity?: string }) {
  const state = useBuilderSidebar(identity)
  const [selected, setSelected] = useState(adapter.selected)
  return (
    <>
      <SidebarControls state={state} canInsert={adapter.canEdit} />
      {state.open && (
        <BuilderSidebar
          state={state}
          adapter={{
            ...adapter,
            selected,
            onSelect: (id) => {
              setSelected(id)
              adapter.onSelect(id)
            },
            onInsert: (item, target) => {
              adapter.onInsert(item, target)
              state.inserted()
            },
          }}
        />
      )}
    </>
  )
}
const adapter = (): SidebarAdapter => ({
  nodes: [
    { id: 'a', kind: 'heading', label: 'Heading', text: 'Hello world', heading: 2 },
    {
      id: 'g',
      kind: 'group',
      label: 'Group',
      container: true,
      children: [{ id: 'b', kind: 'paragraph', label: 'Paragraph', text: 'Inside group' }],
    },
  ],
  items: [
    { kind: 'paragraph', value: 'paragraph', label: 'Paragraph', category: 'Text' },
    { kind: 'image', value: 'image', label: 'Image', category: 'Media' },
  ],
  selected: 'a',
  canEdit: true,
  onSelect: vi.fn(),
  onInsert: vi.fn(),
  onMove: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
})
describe('shared sidebar behavior', () => {
  it('floats actions outside the hierarchy, restores focus, and inserts at the selected position', () => {
    const value = adapter()
    render(<Harness adapter={value} />)
    const trigger = screen.getByRole('button', { name: 'Actions for Heading' })
    expect(screen.queryByRole('button', { name: 'Drag Heading' })).toBeNull()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Heading actions' })
    expect(dialog.closest('.builder-sidebar')).toBeNull()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement?.textContent).toBe('Delete')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Add before' }))
    fireEvent.click(screen.getByRole('button', { name: 'Image' }))
    expect(value.onInsert).toHaveBeenCalledWith(expect.anything(), { parent: 'root', before: 'a' })
  })
  it('excludes a container and its descendants from move destinations', () => {
    render(<Harness adapter={adapter()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Group' }))
    expect(screen.queryByRole('option', { name: 'Group' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Document top level' })).toBeTruthy()
  })
  it('defaults to List View, switches to Outline, and counts visible content', () => {
    render(<Harness adapter={adapter()} />)
    expect(screen.getByRole('tab', { name: 'List View' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Outline' }))
    expect(screen.getByText('4 words · 1 min read')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'H2 Hello world' })).toBeTruthy()
  })
  it('searches categorized tiles, inserts after selection, and returns to List View', () => {
    const value = adapter()
    render(<Harness adapter={value} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search blocks' }), {
      target: { value: 'image' },
    })
    expect(screen.queryByRole('button', { name: 'Paragraph' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Image' }))
    expect(value.onInsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image' }), {
      parent: 'root',
      before: 'g',
    })
    expect(screen.getByRole('tab', { name: 'List View' })).toBeTruthy()
  })
  it('exposes keyboard movement and restores opener focus on Escape', () => {
    const value = adapter()
    render(<Harness adapter={value} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Heading' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }))
    expect(value.onMove).toHaveBeenCalledWith('a', { parent: 'root', before: undefined })
    const opener = screen.getByRole('button', { name: 'Add block' })
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search blocks' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Search blocks' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
  it('keeps locked navigation and outline while removing insertion and structural actions', () => {
    render(<Harness adapter={{ ...adapter(), canEdit: false, locked: true }} />)
    expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Actions for Heading' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Outline' })).toBeTruthy()
  })
  it('resets inserter mode when switching document or region', () => {
    const { rerender } = render(<Harness adapter={adapter()} identity="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }))
    rerender(<Harness adapter={adapter()} identity="footer" />)
    expect(screen.queryByRole('textbox', { name: 'Search blocks' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'List View' })).toBeTruthy()
  })
})
