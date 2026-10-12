// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocumentReviewPanel } from './DocumentReviewPanel'

vi.mock('./EditorHeader', () => ({
  EditorHeaderPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
afterEach(() => {
  cleanup()
  document.querySelectorAll('.builder-frame').forEach((node) => node.remove())
})
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <DocumentReviewPanel count={3} open={open} onOpenChange={setOpen}>
      <p>Review this document</p>
    </DocumentReviewPanel>
  )
}
describe('Document review panel', () => {
  it('portals into the workspace without unmounting editor state and restores focus', async () => {
    const frame = document.createElement('div')
    frame.className = 'builder-frame'
    const input = document.createElement('input')
    input.value = 'Unsaved content'
    frame.appendChild(input)
    document.body.appendChild(frame)
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Tasks (3)' })
    fireEvent.click(trigger)
    await waitFor(() => expect(frame.querySelector('.document-review-panel')).not.toBeNull())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Document tasks' })).toBeNull()
    expect(input.value).toBe('Unsaved content')
    expect(document.activeElement).toBe(trigger)
  })
  it('uses a floating panel when a document has no block workspace', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (3)' }))
    await waitFor(() =>
      expect(document.querySelector('.document-review-panel--floating')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close tasks' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
