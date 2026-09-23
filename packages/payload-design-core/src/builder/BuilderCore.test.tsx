// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuilderCore } from './BuilderCore'

const dnd = vi.hoisted(() => ({ onDragEnd: undefined as undefined | ((event: unknown) => void) }))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: unknown) => void }) => { dnd.onDragEnd = onDragEnd; return children },
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  pointerWithin: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: vi.fn() }))

afterEach(cleanup)

describe('BuilderCore drag boundary', () => {
  it('routes library insertion and existing-node reparenting without document knowledge', () => {
    const insert = vi.fn()
    const move = vi.fn()
    render(<BuilderCore id="test-builder" onInsert={insert} onMove={move}><div>Canvas</div></BuilderCore>)

    dnd.onDragEnd?.({ over: { data: { current: { containerID: 'right-column' } } }, active: { data: { current: { library: { kind: 'field', label: 'Text', value: 'text' } } } } })
    expect(insert).toHaveBeenCalledWith({ kind: 'field', label: 'Text', value: 'text' }, 'right-column')

    dnd.onDragEnd?.({ over: { data: { current: { containerID: 'left-column' } } }, active: { data: { current: { nodeID: 'heading-1' } } } })
    expect(move).toHaveBeenCalledWith('heading-1', 'left-column')
  })
})
