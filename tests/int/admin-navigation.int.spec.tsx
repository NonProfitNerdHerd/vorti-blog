// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  path: '/admin',
  query: '',
  user: 1,
  mobile: false,
  close: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        props.onClick?.(event)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock('@payloadcms/ui', () => ({
  useNav: () => ({ navOpen: true, setNavOpen: state.close }),
  useAuth: () => ({ user: { id: state.user, collection: 'users' } }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, folders: false } }),
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useWindowInfo: () => ({ breakpoints: { l: state.mobile } }),
  BrowseByFolderButton: (): null => null,
  Link: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        props.onClick?.(event)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock('@design-system/payload-design-core/admin', () => ({ useCategoriesEnabled: () => true }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'different-default' } } }),
}))
vi.mock('../../src/review/WorkspaceInbox', () => ({ InboxBadge: (): null => null }))
import { PolicyNav } from '../../src/components/DashboardNavLink'
import { NavigationExpansionProvider } from '../../src/components/NavigationExpansionProvider'
const groups = [
  { label: 'Content', entities: [{ slug: 'posts', type: 'collections', label: 'Posts' }] },
  {
    label: 'Site Design',
    entities: [{ slug: 'design-templates', type: 'collections', label: 'Templates' }],
  },
  { label: 'Forms', entities: [{ slug: 'forms', type: 'collections', label: 'Forms' }] },
  { label: 'Review', entities: [{ slug: 'review-tasks', type: 'collections', label: 'Tasks' }] },
  {
    label: 'Admin',
    entities: [{ slug: 'site-settings', type: 'globals', label: 'Site Settings' }],
  },
]
function Menu({ show = true }: { show?: boolean } = {}) {
  return (
    <NavigationExpansionProvider>
      {show && (
        <PolicyNav
          admin="/admin"
          groups={groups as never}
          navPreferences={{
            open: true,
            groups: { Content: { open: true }, Tasks: { open: true } },
          }}
        />
      )}
    </NavigationExpansionProvider>
  )
}
const button = (label: string) => screen.getByRole('button', { name: label })
afterEach(() => {
  cleanup()
  state.path = '/admin'
  state.query = ''
  state.user = 1
  state.mobile = false
  vi.restoreAllMocks()
  state.close.mockClear()
})
describe('shared admin sidebar groups', () => {
  it('opens Workflows and selects the requested workflow view with site context', () => {
    state.path = '/admin/workflows'
    state.query = 'workflowView=shared&site=chapter-a'
    render(<Menu />)
    expect(button('Toggle Workflows navigation').getAttribute('aria-expanded')).toBe('true')
    const navigation = screen.getByRole('navigation', { name: 'Workflows navigation' })
    expect(within(navigation).getAllByRole('link')).toHaveLength(3)
    expect(
      within(navigation)
        .getByRole('link', { name: 'Shared Workflows' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(
      within(navigation).getByRole('link', { name: 'Create Workflows' }).getAttribute('href'),
    ).toContain('site=chapter-a')
  })
  it('ignores saved expansion, opens routes, preserves manual groups and resets on reload/user changes', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const view = render(<Menu />)
    expect(
      Array.from(view.container.querySelectorAll('.nav-group')).map((group) => group.id),
    ).toEqual([
      'nav-group-Tasks',
      'nav-group-Content',
      'nav-group-CRM',
      'nav-group-Forms',
      'nav-group-Workflows',
      'nav-group-Site Design',
      'nav-group-Admin',
    ])
    expect(view.container.firstElementChild?.textContent).toBe('Dashboard')
    expect(button('Content').getAttribute('aria-expanded')).toBe('false')
    expect(button('Toggle Tasks navigation').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button('Forms'))
    view.rerender(<Menu show={false} />) // Payload remounts page navigation between views.
    state.path = '/admin/collections/posts/create'
    view.rerender(<Menu />)
    expect(button('Content').getAttribute('aria-expanded')).toBe('true')
    expect(button('Forms').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button('Content'))
    view.rerender(<Menu />)
    expect(button('Content').getAttribute('aria-expanded')).toBe('false')
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=chapter-a'
    view.rerender(<Menu />)
    expect(button('Toggle CRM navigation').getAttribute('aria-expanded')).toBe('true')
    expect(button('Forms').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'Constituents' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('link', { name: 'Constituents' }).getAttribute('href')).toContain(
      'site=chapter-a',
    )
    view.unmount()
    const fresh = render(<Menu />)
    expect(button('Forms').getAttribute('aria-expanded')).toBe('false')
    expect(button('Toggle CRM navigation').getAttribute('aria-expanded')).toBe('true')
    state.user = 2
    state.path = '/admin'
    state.query = ''
    fresh.rerender(<Menu />)
    expect(button('Toggle CRM navigation').getAttribute('aria-expanded')).toBe('false')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('handles tool views, globals, custom site administration and query-selected Tasks', () => {
    state.path = '/admin/crm'
    state.query = 'view=attachments&site=a'
    const view = render(<Menu />)
    const crm = screen.getByRole('navigation', { name: 'CRM sections' })
    expect(within(crm).getAllByRole('link')).toHaveLength(11)
    expect(crm.querySelector('[aria-current="page"]')).toBeNull()
    state.path = '/admin/globals/site-settings'
    state.query = ''
    view.rerender(<Menu />)
    expect(button('Admin').getAttribute('aria-expanded')).toBe('true')
    state.path = '/admin/sites'
    view.rerender(<Menu />)
    expect(button('Admin').getAttribute('aria-expanded')).toBe('true')
    state.path = '/admin/collections/review-tasks'
    state.query = 'workspace=boards'
    view.rerender(<Menu />)
    expect(button('Toggle Tasks navigation').getAttribute('aria-expanded')).toBe('true')
    const tasks = screen.getByRole('navigation', { name: 'Tasks navigation' })
    expect(within(tasks).getAllByRole('link')[0].textContent?.trim()).toBe('Inbox')
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page')
  })
  it('retains dirty editors on canceled navigation and leaves modified clicks independent', () => {
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=a'
    state.mobile = true
    const guard = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      render(<Menu />)
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }))
      expect(confirm).toHaveBeenCalledOnce()
      expect(state.close).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }), {
        ctrlKey: true,
      })
      expect(confirm).toHaveBeenCalledOnce()
      expect(state.close).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }))
      expect(state.close).toHaveBeenCalledWith(false)
    } finally {
      window.removeEventListener('beforeunload', guard)
    }
  })
})
