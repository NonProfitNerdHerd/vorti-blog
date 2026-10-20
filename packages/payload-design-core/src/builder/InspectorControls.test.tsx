// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InspectorDevice, InspectorToggle, DeviceControl, Popover } from './InspectorControls'
import { VisualStyleControl } from './VisualStyleControl'
import { resolveStyle, validStyleValue } from '../content/model'
import { validatePresentation } from '../blocks/presentation'
import { ContentBlock } from '../content/ContentRenderer'
import { UnifiedBlockInspector } from './UnifiedBlockInspector'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('allows selecting a Saved View even though its internal styling is centrally managed', () => {
  const change = vi.fn()
  render(<UnifiedBlockInspector node={{ id: 'view', kind: 'savedView', props: {} }} onChange={change}
    renderDocumentPicker={(collection, label, value, update) => <input aria-label={label} data-collection={collection} value={value} onChange={event => update(event.target.value)} />} />)
  const picker = screen.getByRole('textbox', { name: 'Saved View' })
  expect(picker.getAttribute('data-collection')).toBe('saved-views')
  fireEvent.change(picker, { target: { value: '12' } })
  expect(change).toHaveBeenCalledWith({ props: { viewID: '12' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Layout' }))
  expect(screen.getAllByRole('textbox', { name: 'Saved View' })).toHaveLength(1)
})
it('selects a central form without exposing raw IDs or duplicating field settings', () => {
  const change = vi.fn()
  render(<UnifiedBlockInspector node={{ id: 'form-block', kind: 'form', props: {} }} onChange={change}
    renderDocumentPicker={(collection, label, value, update) => <input aria-label={label} data-collection={collection} value={value} onChange={event => update(event.target.value)} />} />)
  const picker = screen.getByRole('textbox', { name: 'Published Form' })
  expect(picker.getAttribute('data-collection')).toBe('forms')
  fireEvent.change(picker, { target: { value: '12,13' } })
  expect(change).toHaveBeenCalledWith({ props: { formID: '13' } })
  expect(screen.queryByRole('textbox', { name: /^Form$/ })).toBeNull()
})
it('selects a named menu and exposes its existing shared editor rather than editing links inside the block', () => {
  const change = vi.fn()
  render(<UnifiedBlockInspector node={{ id: 'menu-block', kind: 'menu', props: {} }} onChange={change}
    renderDocumentPicker={(collection, label, value, update) => <input aria-label={label} data-collection={collection} value={value} onChange={event => update(event.target.value)} />} />)
  fireEvent.click(screen.getByRole('tab', { name: 'Layout' }))
  const picker = screen.getByRole('textbox', { name: 'Menu' })
  expect(picker.getAttribute('data-collection')).toBe('menus')
  fireEvent.change(picker, { target: { value: '12' } })
  expect(change).toHaveBeenCalledWith({ props: { menuID: '12' } })
  expect(screen.getByRole('link', { name: 'Edit menu' }).getAttribute('href')).toBe('/admin/globals/navigation')
  expect(screen.queryByRole('textbox', {name:'Navigation label'})).toBeNull()
})
it('dismisses only the inspector and leaves external dialogs in control of Escape', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const change = vi.fn()
  render(
    <>
      <InspectorToggle open change={change} />
      <aside className="content-workspace__right">
        <input aria-label="Inspector value" />
      </aside>
      <input aria-label="Media picker value" />
    </>,
  )
  fireEvent.keyDown(screen.getByLabelText('Media picker value'), { key: 'Escape' })
  expect(change).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByLabelText('Inspector value'), { key: 'Escape' })
  expect(change).toHaveBeenCalledWith(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Toggle inspector' }))
})
it('renders image overlays on the media surface without fading captions', () => {
  const { container } = render(
    <ContentBlock
      node={{
        id: 'overlay-image',
        kind: 'image',
        media: { url: '/image.png' },
        text: 'Readable caption',
        presentation: {
          background: {
            gradient: 'linear-gradient(90deg, #ffffff, #000000)',
            opacity: 0.4,
            blendMode: 'multiply',
          },
        },
      }}
    />,
  )
  expect(container.querySelector('img')?.parentElement?.className).toBe('block-image-surface')
  expect(screen.getByText('Readable caption').closest('.block-image-surface')).toBeNull()
  const block = container.querySelector<HTMLElement>('[data-block-kind=image]')!
  expect(block.style.opacity).toBe('')
  expect(
    Array.from(block.querySelectorAll('style'))
      .map((style) => style.textContent)
      .join(''),
  ).toContain('--block-overlay-opacity:0.4')
})
it('changes the shared device without writing a style and restores popover focus', () => {
  const change = vi.fn()
  render(
    <InspectorDevice.Provider value={{ viewport: 'desktop', change }}>
      <DeviceControl label="Height" />
    </InspectorDevice.Provider>,
  )
  const opener = screen.getByRole('button', { name: 'Height device' })
  fireEvent.click(opener)
  fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
  expect(change).toHaveBeenCalledWith('tablet')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})
it('resets one shorthand side while preserving its siblings and device inheritance', () => {
  const updateMany = vi.fn()
  render(
    <VisualStyleControl
      name="padding"
      value="10px 20px"
      inherited="5px"
      inheritedValues={{ padding: '5px' }}
      values={{ padding: '10px 20px' }}
      update={vi.fn()}
      updateMany={updateMany}
      state="normal"
      setState={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reset Padding top' }))
  const patch = updateMany.mock.calls[0][0]
  expect(patch).toEqual({
    padding: '',
    paddingTop: '',
    paddingRight: '20px',
    paddingBottom: '10px',
    paddingLeft: '20px',
  })
  const tablet = Object.fromEntries(Object.entries(patch).filter(([, v]) => v)) as Record<
    string,
    string
  >
  expect(resolveStyle({ desktop: { padding: '5px' }, tablet }, 'mobile')).toMatchObject({
    paddingTop: '5px',
    paddingRight: '20px',
  })
})
it('validates multistop gradients and overlay values on the server', () => {
  const gradient = 'linear-gradient(90deg, #ffffff, #00000088, #ff0000)'
  expect(validStyleValue('backgroundImage', gradient)).toBe(true)
  expect(
    validatePresentation({ background: { gradient, blendMode: 'multiply', opacity: 0.4 } }),
  ).toBeFalsy()
  expect(
    validatePresentation({ background: { gradient: 'url(javascript:alert(1))' } }),
  ).toBeTruthy()
  expect(validStyleValue('paddingLeft', '12px')).toBe(true)
})
it('keeps a popover within the viewport and supports outside dismissal', () => {
  render(
    <Popover label="Color" trigger="Color">
      <input aria-label="Hex" />
    </Popover>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Color' }))
  expect(screen.getByRole('dialog').style.position).toBe('fixed')
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})
