// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ path: '/admin', query: '', user: 1, mobile: false,
  permissions: ['crm:read', 'intranet:read', 'workflows:read'], close: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _prefetch, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) =>
  <a {...props} href={href} onClick={event => { props.onClick?.(event); event.preventDefault() }}>{children}</a> }))
vi.mock('@payloadcms/ui', () => ({
  useNav: () => ({ navOpen: true, setNavOpen: state.close }),
  useAuth: () => ({ user: { id: state.user, collection: 'users', platformPermissions: state.permissions } }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, folders: false } }),
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useWindowInfo: () => ({ breakpoints: { l: state.mobile } }),
  BrowseByFolderButton: (): null => null,
}))
vi.mock('@design-system/payload-design-core/admin', () => ({ useCategoriesEnabled: () => true }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
vi.mock('../../src/review/WorkspaceInbox', () => ({ InboxBadge: (): null => null }))
import { PolicyNav } from '../../src/components/DashboardNavLink'
import { CRMSecondaryNav, CRMSecondaryToggle } from '../../src/components/CRMSecondaryNav'
import { CRMSecondaryProvider } from '../../src/components/CRMSecondaryProvider'

const groups = [
  { label: 'Tasks', entities: [{ slug: 'review-tasks', type: 'collections', label: 'Tasks' }] },
  { label: 'Content', entities: [{ slug: 'posts', type: 'collections', label: 'Posts' }, { slug: 'pages', type: 'collections', label: 'Pages' }] },
  { label: 'Forms', entities: [{ slug: 'forms', type: 'collections', label: 'Forms' }, { slug: 'form-submissions', type: 'collections', label: 'Submissions' }] },
  { label: 'Site Design', entities: [{ slug: 'design-templates', type: 'collections', label: 'Templates' }] },
  { label: 'Admin', entities: [{ slug: 'site-settings', type: 'globals', label: 'Site Settings' }] },
]
function Menu() {
  return <CRMSecondaryProvider identity={`users:${state.user}`}>
    <PolicyNav admin="/admin" groups={groups as never} />
    <CRMSecondaryToggle groups={groups as never} />
    <CRMSecondaryNav groups={groups as never} />
  </CRMSecondaryProvider>
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  state.path = '/admin'
  state.query = ''
  state.user = 1
  state.mobile = false
  state.permissions = ['crm:read', 'intranet:read', 'workflows:read']
  state.close.mockClear()
  vi.restoreAllMocks()
})

describe('shared module navigation', () => {
  it('uses one primary link per module and preserves first-section routes and audience', () => {
    state.path = '/admin/collections/posts'
    state.query = 'site=chapter-a&audience=public'
    render(<Menu />)
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('href')).toContain('workspace=inbox')
    expect(screen.getByRole('link', { name: 'Content' }).getAttribute('href')).toContain('audience=public')
    expect(screen.getByRole('link', { name: 'Intranet' }).getAttribute('href')).toContain('audience=intranet')
    expect(screen.getByRole('link', { name: 'CRM' }).getAttribute('href')).toContain('view=overview')
    expect(screen.getByRole('link', { name: 'Forms' }).getAttribute('href')).toContain('/admin/collections/forms?site=chapter-a')
    expect(screen.getByRole('link', { name: 'Workflows' }).getAttribute('href')).toContain('workflowView=create')
    expect(screen.getByRole('link', { name: 'Site Design' }).getAttribute('href')).toContain('/admin/collections/design-templates?site=chapter-a')
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toContain('/admin/globals/site-settings?site=chapter-a')
    const content = screen.getByRole('navigation', { name: 'Content sections' })
    expect(within(content).getByRole('link', { name: 'Posts' }).getAttribute('aria-current')).toBe('page')
    expect(within(content).getByRole('link', { name: 'Pages' }).getAttribute('href')).toContain('site=chapter-a')
  })

  it('remembers each module close choice and offers a temporary flyout and pinned return', () => {
    state.path = '/admin/crm'
    state.query = 'view=contacts&site=default'
    const view = render(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
    expect(screen.getByText('VortiCause')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close CRM sidebar' }))
    expect(screen.queryByRole('navigation', { name: 'CRM sections' })).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'CRM' }))
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'CRM' }))
    expect(localStorage.getItem('vorti:secondary:users:1:CRM')).toBe('open')
    state.path = '/admin/collections/forms'
    state.query = ''
    view.rerender(<Menu />)
    expect(screen.getByRole('navigation', { name: 'Forms sections' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Forms sidebar' }))
    view.unmount()
    const restored = render(<Menu />)
    expect(screen.queryByRole('navigation', { name: 'Forms sections' })).toBeNull()
    state.path = '/admin/crm'
    restored.rerender(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
    restored.unmount()
    render(<Menu />)
    expect(screen.getByRole('navigation', { name: 'CRM sections' })).toBeTruthy()
  })

  it('opens the same links in a mobile drawer and dismisses it from the keyboard', () => {
    state.mobile = true
    state.path = '/admin/collections/review-tasks'
    state.query = 'workspace=inbox'
    render(<Menu />)
    expect(screen.queryByRole('navigation', { name: 'Tasks sections' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tasks menu' }))
    const nav = screen.getByRole('navigation', { name: 'Tasks sections' })
    expect(within(nav).getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('VortiTasks')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Tasks navigation' }), { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'Tasks sections' })).toBeNull()
  })

  it('prompts once for an ordinary navigation and leaves modified clicks independent', () => {
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
      confirm.mockReturnValue(true)
      fireEvent.click(screen.getByRole('link', { name: 'Donations' }))
      expect(state.close).not.toHaveBeenCalled()
    } finally { window.removeEventListener('beforeunload', guard) }
  })

  it('omits modules without the corresponding permissions', () => {
    state.permissions = []
    state.path = '/admin/collections/forms'
    render(<Menu />)
    expect(screen.queryByRole('link', { name: 'CRM' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Intranet' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Workflows' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Forms sections' })).toBeTruthy()
  })
})
