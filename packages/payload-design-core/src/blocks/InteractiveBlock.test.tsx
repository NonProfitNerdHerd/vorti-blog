import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import InteractiveBlock from './InteractiveBlock'
import { EditingSelection } from './EditingSelection'
import Listing, { ListingNavigation } from './Listing'
import { createContentNode } from '../content/model'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('interactive blocks', () => {
  it('moves tab selection and focus with arrow keys', () => {
    const node = createContentNode('tabs')
    render(
      <InteractiveBlock node={node}>
        <p>First panel</p>
        <p>Second panel</p>
      </InteractiveBlock>,
    )
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
    expect(screen.getByRole('tabpanel').textContent).toContain('Second panel')
  })
  it('supports expansion and notification dismissal without deleting content', () => {
    const { rerender } = render(
      <InteractiveBlock node={createContentNode('expand')}>
        <p>Expanded content</p>
      </InteractiveBlock>,
    )
    const button = screen.getByRole('button', { name: 'Read more' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    rerender(
      <InteractiveBlock node={createContentNode('notification')}>
        <p>Notification content</p>
      </InteractiveBlock>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Notification content')).toBeNull()
  })
  it('loads and appends a linked listing page and reports the end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          results: [{ title: 'Second post', url: '/posts/second' }],
          page: 2,
          totalPages: 2,
        }),
      ),
    )
    const node = createContentNode('postListing')
    node.props = {
      ...node.props,
      results: [{ title: 'First post', url: '/posts/first' }],
      page: 1,
      totalPages: 2,
    }
    const navigation = createContentNode('loadMore')
    navigation.props = { listingID: node.id }
    render(
      <>
        <Listing node={node} />
        <ListingNavigation node={navigation} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getByText('Second post')).toBeTruthy())
    expect(screen.getByText('First post')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(screen.getByText('No more content.')).toBeTruthy()
  })
  it('navigates slides while editing without removing nested content', () => {
    render(
      <InteractiveBlock node={createContentNode('carousel')} editing>
        <p>First slide</p>
        <p>Second slide</p>
      </InteractiveBlock>,
    )
    expect(screen.getByText('First slide')).toBeTruthy()
    expect(screen.getByText('Second slide')).toBeTruthy()
    expect(screen.getByText('Second slide').parentElement?.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(screen.getByText('Second slide').parentElement?.hidden).toBe(false)
    expect(screen.getByText('First slide').parentElement?.hidden).toBe(true)
  })
  it('accepts typed URLs without committing incomplete or unsafe input', () => {
    const change = vi.fn()
    render(<UnifiedBlockInspector node={createContentNode('image')} onChange={change} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    const input = screen.getByLabelText('Url')
    fireEvent.change(input, { target: { value: 'h' } })
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'https://example.com/image' } })
    fireEvent.blur(input)
    expect(change).toHaveBeenCalledWith({
      presentation: { link: { url: 'https://example.com/image' } },
    })
    change.mockClear()
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.blur(input)
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Invalid block link')
  })
})

describe('editing selection and previews', () => {
  it('reveals nested selection without persisting panel state and clamps after removal', async () => {
    const node = createContentNode('tabs')
    node.children = [
      { id: 'first', kind: 'group', children: [{ id: 'a', kind: 'paragraph' }] },
      { id: 'second', kind: 'group', children: [{ id: 'b', kind: 'paragraph' }] },
    ]
    const before = JSON.stringify(node)
    const { rerender } = render(
      <EditingSelection.Provider value="b">
        <InteractiveBlock node={node} editing>
          <p>One</p>
          <p>Two</p>
        </InteractiveBlock>
      </EditingSelection.Provider>,
    )
    await waitFor(() => expect(screen.getByRole('tabpanel').textContent).toBe('Two'))
    expect(JSON.stringify(node)).toBe(before)
    rerender(
      <InteractiveBlock node={{ ...node, children: node.children.slice(0, 1) }} editing>
        <p>One</p>
      </InteractiveBlock>,
    )
    expect(screen.getByRole('tabpanel').textContent).toBe('One')
  })
  it('uses device slide counts and keeps loop order', () => {
    const node = createContentNode('carousel')
    node.props = { slidesPerView: 2, mobileSlides: 1, loop: true }
    const { rerender } = render(
      <InteractiveBlock node={node} editing viewport="desktop">
        <p>One</p>
        <p>Two</p>
        <p>Three</p>
      </InteractiveBlock>,
    )
    expect(screen.getAllByRole('group')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    expect(screen.getByText('Three').parentElement?.style.order).toBe('0')
    rerender(
      <InteractiveBlock node={node} editing viewport="mobile">
        <p>One</p>
        <p>Two</p>
        <p>Three</p>
      </InteractiveBlock>,
    )
    expect(screen.getAllByRole('group')).toHaveLength(1)
  })
  it('loads an authenticated draft listing preview and reports errors', async () => {
    const fetcher = vi.fn(async (_url?: string, _options?: RequestInit) =>
      Response.json({
        results: [{ title: 'Draft preview', url: '/draft' }],
        page: 1,
        totalPages: 1,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const node = createContentNode('postListing')
    const { rerender } = render(<Listing node={node} editing />)
    await waitFor(() => expect(screen.getByText('Draft preview')).toBeTruthy())
    expect(fetcher.mock.calls[0]?.[0]).toContain('draft=true')
    fetcher.mockImplementation(async () => new Response('', { status: 403 }))
    rerender(<Listing node={{ ...node, props: { ...node.props, limit: 2 } }} editing />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to load'))
  })
})

it('honors the initially open accordion panel and retains dismissed notices on remount', async () => {
  const node = createContentNode('accordion')
  node.props = { initialPanel: 1 }
  const { unmount } = render(
    <InteractiveBlock node={node}>
      <p>First content</p>
      <p>Second content</p>
    </InteractiveBlock>,
  )
  expect(screen.getByText('Second content').closest('details')?.open).toBe(true)
  expect(screen.getByText('First content').closest('details')?.open).toBe(false)
  unmount()
  const notice = createContentNode('notification')
  const first = render(
    <InteractiveBlock node={notice}>
      <p>Session notice</p>
    </InteractiveBlock>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  first.unmount()
  render(
    <InteractiveBlock node={notice}>
      <p>Session notice</p>
    </InteractiveBlock>,
  )
  await waitFor(() => expect(screen.queryByText('Session notice')).toBeNull())
  sessionStorage.clear()
})
