// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const drawer = vi.hoisted(() => ({ saved: undefined as undefined | ((args: { doc: object }) => void), open: vi.fn() }))
vi.mock('@payloadcms/ui', () => ({ useDocumentDrawer: () => [({ onSave }: { onSave: typeof drawer.saved }): React.ReactNode => { drawer.saved = onSave; return null }, (): React.ReactNode => null, { openDrawer: drawer.open, closeDrawer: vi.fn(), isDrawerOpen: false }] }))
import { PostTemplateChooser } from '../../packages/payload-design-core/src/admin/PostTemplateChooser'
import type { Template } from '@design-system/payload-design-core'
afterEach(cleanup)
describe('Post creation chooser', () => {
  it('requires selection, includes Blank, and does not create records when canceled', () => {
    const choose = vi.fn(), cancel = vi.fn()
    render(<PostTemplateChooser templates={[]} onChoose={choose} onCancel={cancel} onCreated={vi.fn()} onRetry={vi.fn()} />)
    const create = screen.getByRole('button', { name: 'Create Post' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blank' } })
    expect(create.disabled).toBe(false)
    expect(screen.getByText(/empty block-based editor/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(choose).not.toHaveBeenCalled()
  })
  it('keeps chooser controls outside the native Post form', () => {
    render(<form data-testid="native-post-form"><PostTemplateChooser templates={[]} onChoose={vi.fn()} onCancel={vi.fn()} onCreated={vi.fn()} onRetry={vi.fn()} /></form>)
    expect(screen.getByTestId('native-post-form').contains(screen.getByRole('dialog', { name: 'Select a template' }))).toBe(false)
  })
  it('reuses the template drawer, preserves selection on cancel and selects a saved template', () => {
    const template = { id: 1, name: 'Article', description: 'An editorial layout' } as Template
    const choose = vi.fn(), created = vi.fn()
    render(<PostTemplateChooser templates={[template]} onChoose={choose} onCancel={vi.fn()} onCreated={created} onRetry={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create a Template' }))
    expect(drawer.open).toHaveBeenCalled()
    expect(screen.getByLabelText('Template')).toHaveProperty('value', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Create Post' }))
    expect(choose).toHaveBeenCalledWith('1')
    drawer.saved?.({ doc: { ...template, id: 2 } })
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })
})
