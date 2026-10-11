import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import InteractiveBlock from './InteractiveBlock'
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
  it('keeps all nested content visible while editing interactive containers', () => {
    render(
      <InteractiveBlock node={createContentNode('carousel')} editing>
        <p>First slide</p>
        <p>Second slide</p>
      </InteractiveBlock>,
    )
    expect(screen.getByText('First slide')).toBeTruthy()
    expect(screen.getByText('Second slide')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
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
    expect(change).toHaveBeenCalledWith({ presentation: { link: { url: 'https://example.com/image' } } })
    change.mockClear()
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.blur(input)
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Invalid block link')
  })

})
