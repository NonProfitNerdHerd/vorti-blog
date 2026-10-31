// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const groups = [
  { label: 'Tasks', entities: [{ slug: 'review-tasks', type: 'collections', label: 'Tasks' }] },
  { label: 'Content', entities: [{ slug: 'posts', type: 'collections', label: 'Posts' }, { slug: 'pages', type: 'collections', label: 'Pages' }] },
  { label: 'Forms', entities: [{ slug: 'forms', type: 'collections', label: 'Forms' }, { slug: 'form-submissions', type: 'collections', label: 'Submissions' }] },
  { label: 'Site Design', entities: [{ slug: 'design-templates', type: 'collections', label: 'Templates' }] },
  { label: 'Admin', entities: [{ slug: 'site-settings', type: 'globals', label: 'Site Settings' }] },
]
function Menu() {
  return <><PolicyNav admin="/admin" groups={groups as never} />
    <PrimaryMenuToggle />
    <CRMSecondaryNav groups={groups as never} /></>
}
afterEach(() => {
  cleanup()
  state.path = '/admin'
  state.query = ''
  state.user = 1
  state.navOpen = false
  state.permissions = ['crm:read', 'intranet:read', 'workflows:read']
  state.close.mockClear()
  vi.restoreAllMocks()
})
describe('waffle module navigation', () => {
  it('shows route-selected secondary links until the waffle opens primary modules', () => {
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=chapter-a'
    const view = render(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    expect(screen.queryByRole('navigation', { name: 'CRM sections' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close primary menu' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'CRM' }).getAttribute('href')).toContain('site=chapter-a')
    fireEvent.keyDown(document, { key: 'Escape' })
    view.rerender(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
  })
  it('selects Tasks from primary, closes it, and shows the Tasks sections on the new route', () => {
    state.path = '/admin/crm'
    const view = render(<Menu />)
    fireEvent.click(screen.getByRole('button', { name: 'Open primary menu' }))
    view.rerender(<Menu />)
    const tasks = screen.getByRole('link', { name: 'Tasks' })
    expect(tasks.getAttribute('href')).toContain('workspace=inbox')
    fireEvent.click(tasks)
    expect(state.close).toHaveBeenLastCalledWith(false)
    state.path = '/admin/collections/review-tasks'
    state.query = 'workspace=inbox'
    view.rerender(<Menu />)
    const secondary = screen.getByRole('navigation', { name: 'Tasks sections' })
    expect(within(secondary).getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page')
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
})