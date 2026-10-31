// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ path: '/admin', query: '', user: 1, navOpen: false,
  permissions: ['crm:read', 'intranet:read', 'workflows:read'], close: vi.fn((open: boolean) => { state.navOpen = open }) }))
vi.mock('next/navigation', () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _prefetch, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) =>
  <a {...props} href={href} onClick={event => { props.onClick?.(event); event.preventDefault() }}>{children}</a> }))
vi.mock('@payloadcms/ui', () => ({
  useNav: () => ({ navOpen: state.navOpen, setNavOpen: state.close }),
  useAuth: () => ({ user: { id: state.user, collection: 'users', platformPermissions: state.permissions } }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, folders: false } }),
  useTranslation: () => ({ i18n: { language: 'en' } }),
  BrowseByFolderButton: (): null => null,
}))
vi.mock('@design-system/payload-design-core/admin', () => ({ useCategoriesEnabled: () => true }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
vi.mock('../../src/review/WorkspaceInbox', () => ({ InboxBadge: (): null => null }))
import { PolicyNav } from '../../src/components/DashboardNavLink'
import { CRMSecondaryNav } from '../../src/components/CRMSecondaryNav'
import { PrimaryMenuToggle } from '../../src/components/PrimaryMenuToggle'
import { PrimaryNavigationContext } from '../../src/components/PrimaryNavigationContext'

const startNavigation = vi.fn()

const groups = [
  { label: 'Tasks', entities: [{ slug: 'review-tasks', type: 'collections', label: 'Tasks' }] },
  { label: 'Content', entities: [{ slug: 'posts', type: 'collections', label: 'Posts' }, { slug: 'pages', type: 'collections', label: 'Pages' }] },
  { label: 'Forms', entities: [{ slug: 'forms', type: 'collections', label: 'Forms' }, { slug: 'form-submissions', type: 'collections', label: 'Submissions' }] },
  { label: 'Site Design', entities: [
    { slug: 'design-templates', type: 'collections', label: 'Templates' },
    { slug: 'navigation', type: 'globals', label: 'Menus' },
  ] },
  { label: 'Admin', entities: [{ slug: 'site-settings', type: 'globals', label: 'Site Settings' }] },
]
function Menu({ visibleGroups = groups }: { visibleGroups?: typeof groups } = {}) {
  return <PrimaryNavigationContext.Provider value={{ startNavigation }}><PolicyNav admin="/admin" groups={visibleGroups as never} />
    <PrimaryMenuToggle />
    <CRMSecondaryNav groups={visibleGroups as never} /></PrimaryNavigationContext.Provider>
}
afterEach(() => {
  cleanup()
  state.path = '/admin'
  state.query = ''
  state.user = 1
  state.navOpen = false
  state.permissions = ['crm:read', 'intranet:read', 'workflows:read']
  state.close.mockClear()
  startNavigation.mockClear()
  vi.restoreAllMocks()
})
describe('waffle module navigation', () => {
  it('shows Extranet instead of Site Design and keeps design links in both publishing menus', () => {
    state.path = '/admin/collections/design-templates'
    state.query = 'site=chapter-a'
    const view = render(<Menu />)
    const extranet = screen.getByRole('navigation', { name: 'Extranet sections' })
    expect(screen.getByRole('complementary', { name: 'Extranet navigation' }).textContent).toContain('Extranet')
    expect(within(extranet).getByRole('link', { name: 'Templates' }).getAttribute('aria-current')).toBe('page')
    expect(within(extranet).getByRole('link', { name: 'Menus' }).getAttribute('href'))
      .toBe('/admin/globals/navigation?site=chapter-a&audience=public')
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    expect(screen.getByRole('link', { name: 'Extranet' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Site Design' })).toBeNull()
    state.navOpen = false
    state.path = '/admin/globals/navigation'
    state.query = 'site=chapter-a&audience=intranet'
    view.rerender(<Menu />)
    const intranet = screen.getByRole('navigation', { name: 'Intranet sections' })
    expect(within(intranet).getByRole('link', { name: 'Menus' }).getAttribute('aria-current')).toBe('page')
    expect(within(intranet).getByRole('link', { name: 'Templates' }).getAttribute('href'))
      .toBe('/admin/collections/design-templates?site=chapter-a&audience=intranet')
  })
  it('uses only permission-filtered design links and preserves the unsaved-change prompt', () => {
    state.path = '/admin/collections/design-templates'
    state.query = 'site=default&audience=intranet'
    const guard = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      render(<Menu />)
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Intranet sections' })).getByRole('link', { name: 'Menus' }))
      expect(confirm).toHaveBeenCalledOnce()
    } finally { window.removeEventListener('beforeunload', guard) }
    cleanup()
    state.path = '/admin/globals/navigation'
    render(<Menu visibleGroups={groups.map(group => group.label === 'Site Design'
      ? { ...group, entities: group.entities.filter(entity => entity.slug === 'navigation') } : group)} />)
    expect(screen.queryByRole('link', { name: 'Templates' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Intranet sections' })).getByRole('link', { name: 'Menus' })).toBeTruthy()
  })
  it('shows route-selected secondary links until the waffle opens primary modules', () => {
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=chapter-a'
    const view = render(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    expect(screen.queryByRole('navigation', { name: 'CRM sections' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close primary menu' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('VortiPress')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'CRM' }).getAttribute('href')).toContain('site=chapter-a')
    fireEvent.keyDown(document, { key: 'Escape' })
    view.rerender(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
  })
  it('selects Tasks from primary and keeps it open until the route changes', () => {
    state.path = '/admin/crm'
    const view = render(<Menu />)
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    const tasks = screen.getByRole('link', { name: 'Tasks' })
    expect(tasks.getAttribute('href')).toContain('workspace=inbox')
    fireEvent.click(tasks)
    expect(startNavigation).toHaveBeenCalledWith(expect.stringContaining('/admin/collections/review-tasks'))
    expect(state.close).not.toHaveBeenCalledWith(false)
    expect(screen.queryByRole('navigation', { name: 'CRM sections' })).toBeNull()
    state.path = '/admin/collections/review-tasks'
    state.query = 'workspace=inbox'
    state.navOpen = false
    view.rerender(<Menu />)
    const secondary = screen.getByRole('navigation', { name: 'Tasks sections' })
    expect(within(secondary).getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page')
  })
  it('closes immediately for Dashboard when already there and holds for Wiki until unload', () => {
    state.permissions = [...state.permissions, 'wiki:read']
    const view = render(<Menu />)
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(state.close).toHaveBeenLastCalledWith(false)
    state.navOpen = true
    view.rerender(<Menu />)
    fireEvent.click(screen.getByRole('link', { name: 'Wiki' }))
    expect(startNavigation).toHaveBeenCalledWith(expect.stringContaining('/wiki?'))
    expect(state.navOpen).toBe(true)
  })
  it('shows no secondary menu on Dashboard and filters unauthorized modules', () => {
    state.permissions = []
    render(<Menu />)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('link', { name: 'CRM' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Intranet' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Workflows' })).toBeNull()
  })
  it('keeps unsaved-change prompts for ordinary secondary navigation', () => {
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=default'
    const guard = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      render(<Menu />)
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }))
      expect(confirm).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }), { ctrlKey: true })
      expect(confirm).toHaveBeenCalledOnce()
    } finally { window.removeEventListener('beforeunload', guard) }
  })
  it('keeps the primary menu open when unsaved changes block navigation', () => {
    state.path = '/admin/crm'
    const guard = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      const view = render(<Menu />)
      fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
      view.rerender(<Menu />)
      fireEvent.click(screen.getByRole('link', { name: 'Tasks' }))
      expect(confirm).toHaveBeenCalledOnce()
      expect(startNavigation).not.toHaveBeenCalled()
      expect(screen.getByText('VortiPress')).toBeTruthy()
    } finally { window.removeEventListener('beforeunload', guard) }
  })
  it('returns focus to the waffle on Escape and moves it into the destination menu on arrival', async () => {
    state.path = '/admin/crm'
    const view = render(<Menu />)
    const waffle = screen.getByRole('button', { name: 'Open primary menu' })
    fireEvent.click(waffle)
    view.rerender(<Menu />)
    fireEvent.keyDown(document, { key: 'Escape' })
    view.rerender(<Menu />)
    await waitFor(() => expect(document.activeElement).toBe(waffle))
    fireEvent.click(waffle)
    view.rerender(<Menu />)
    state.path = '/admin/collections/review-tasks'
    state.query = 'workspace=inbox'
    state.navOpen = false
    view.rerender(<Menu />)
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('navigation', { name: 'Tasks sections' })).getByRole('link', { name: 'Inbox' })))
  })
})
