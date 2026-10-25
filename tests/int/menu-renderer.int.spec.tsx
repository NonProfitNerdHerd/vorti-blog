// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Menu, type ResolvedMenu } from '@design-system/payload-design-core/content'
afterEach(cleanup)
const menu: ResolvedMenu = {
  id: 1,
  name: 'Main',
  items: [
    {
      key: 'a',
      label: 'About',
      href: '/about',
      children: [
        {
          key: 'b',
          label: 'Team',
          href: '/team',
          newTab: true,
          children: [{ key: 'c', label: 'Deep', href: '/deep', children: [] }],
        },
      ],
    },
  ],
}
it('server-renders safe links and independent level limits without fetching', () => {
  const html = renderToStaticMarkup(<Menu menuID="1" initial={menu} depth={2} />)
  expect(html).toContain('href="/team"')
  expect(html).toContain('noopener noreferrer')
  expect(html).not.toContain('href="/deep"')
  expect(html).toContain('Expand About submenu')
})
it('uses independent disclosure IDs and closes a keyboard submenu with Escape', () => {
  const { container } = render(
    <>
      <Menu menuID="1" initial={menu} label="First" />
      <Menu menuID="1" initial={menu} label="Second" />
    </>,
  )
  const ids = Array.from(container.querySelectorAll('[id]')).map((item) => item.id)
  expect(new Set(ids).size).toBe(ids.length)
  const first = screen.getByRole('navigation', { name: 'First' })
  const summary = first.querySelector('[aria-label="Expand About submenu"]') as HTMLElement
  const details = summary.closest('details')!
  details.open = true
  fireEvent.keyDown(summary, { key: 'Escape' })
  expect(details.open).toBe(false)
  expect(document.activeElement).toBe(summary)
})
