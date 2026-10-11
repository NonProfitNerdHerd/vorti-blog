// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspaceFrame } from './WorkspaceFrame'

afterEach(cleanup)
function Frame() {
  const ref = useWorkspaceFrame()
  return <div ref={ref} data-testid="frame" />
}
const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  left: x,
  right: x + width,
  top: y,
  bottom: y + height,
  width,
  height,
  toJSON: () => ({}),
})
describe('workspace geometry', () => {
  it('tracks header wrapping and releases observers when the editor unmounts', async () => {
    let header = rect(240, 100, 900, 50)
    const result = render(
      <>
        <div
          className="doc-controls"
          ref={(element) => {
            if (element) element.getBoundingClientRect = () => header
          }}
        />
        <Frame />
      </>,
    )
    const frame = result.getByTestId('frame')
    expect(frame.style.getPropertyValue('--workspace-top')).toBe('150px')
    expect(frame.style.getPropertyValue('--workspace-left')).toBe('240px')
    expect(frame.style.getPropertyValue('--workspace-height')).toBe(`${window.innerHeight - 150}px`)
    header = rect(0, 100, 1140, 100)
    fireEvent.resize(window)
    await waitFor(() => expect(frame.style.getPropertyValue('--workspace-top')).toBe('200px'))
    expect(frame.style.getPropertyValue('--workspace-left')).toBe('0px')
    result.unmount()
    header = rect(0, 100, 1140, 150)
    fireEvent.resize(window)
    expect(frame.style.getPropertyValue('--workspace-top')).toBe('200px')
  })
  it('uses the current drawer header and bottom, not the underlying document', async () => {
    const result = render(
      <>
        <div className="doc-controls" />
        <div
          role="dialog"
          ref={(element) => {
            if (element) element.getBoundingClientRect = () => rect(300, 40, 700, 600)
          }}
        >
          <div
            className="doc-controls"
            ref={(element) => {
              if (element) element.getBoundingClientRect = () => rect(300, 90, 700, 70)
            }}
          />
          <Frame />
        </div>
      </>,
    )
    const frame = result.getByTestId('frame')
    expect(frame.style.getPropertyValue('--workspace-top')).toBe('160px')
    fireEvent.resize(window)
    await waitFor(() => expect(frame.style.getPropertyValue('--workspace-height')).toBe('480px'))
    expect(frame.style.getPropertyValue('--workspace-width')).toBe('700px')
  })
})
