// DOM environment is selected by the dom Vitest project.
import { createContext, useContext } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pathname: '/admin',
  query: '',
  user: { role: 'administrator' } as { role: string } | null,
  native: vi.fn(),
  replace: vi.fn(),
  login: vi.fn(),
  remember: vi.fn(),
  restore: vi.fn(),
}))
const TestNav = createContext({ navOpen: false, setNavOpen: (_open: boolean) => {} })
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ replace: state.replace, refresh: vi.fn() }),
}))
vi.mock('@payloadcms/ui', () => ({
  NavContext: TestNav,
  useNav: () => ({ navOpen: true, setNavOpen: state.native, hydrated: true }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, admin: { routes: { login: '/login' } } } }),
  useAuth: () => ({ user: state.user, refreshPermissions: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('@design-system/payload-design-core/admin', () => ({
  CategoriesEnabledProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/auth-return', () => ({ redirectToLogin: state.login, rememberReturnPath: state.remember, restoreInactivityReturn: state.restore }))
const { AdminPolicyClient } = await import('@/components/AdminPolicyClient')
const { usePrimaryNavigation } = await import('@/components/PrimaryNavigationContext')
function Controls() {
  const { navOpen, setNavOpen } = useContext(TestNav)
  const { startNavigation } = usePrimaryNavigation()
  return <><button onClick={() => setNavOpen(!navOpen)}>{navOpen ? 'Close menu' : 'Open menu'}</button>
    <button onClick={() => startNavigation('/admin/collections/review-tasks?workspace=inbox')}>Go to tasks</button>
    <button onClick={() => startNavigation('/admin/collections/posts?site=default&audience=intranet')}>Go to intranet</button></>
}
function Policy() {
  return <AdminPolicyClient initialCategoriesEnabled><Controls /></AdminPolicyClient>
}
afterEach(() => {
  cleanup()
  state.pathname = '/admin'
  state.query = ''
  state.user = { role: 'administrator' }
  vi.clearAllMocks()
})
describe('Admin menu and sign-in policy', () => {
  it('starts with the primary menu closed and closes it on route changes', () => {
    const view = render(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    fireEvent.click(screen.getByText('Open menu'))
    expect(screen.getByText('Close menu')).toBeTruthy()
    state.pathname = '/admin/collections/posts'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    expect(state.login).not.toHaveBeenCalled()
  })
  it('holds the menu over the old module until a different pathname arrives', () => {
    state.pathname = '/admin/crm'
    const view = render(<Policy />)
    fireEvent.click(screen.getByText('Open menu'))
    fireEvent.click(screen.getByText('Go to tasks'))
    expect(screen.getByText('Close menu')).toBeTruthy()
    view.rerender(<Policy />)
    expect(screen.getByText('Close menu')).toBeTruthy()
    state.pathname = '/admin/collections/review-tasks'
    state.query = 'workspace=inbox'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
  })
  it('waits for query changes when modules share a pathname', () => {
    state.pathname = '/admin/collections/posts'
    state.query = 'site=default&audience=public'
    const view = render(<Policy />)
    fireEvent.click(screen.getByText('Open menu'))
    fireEvent.click(screen.getByText('Go to intranet'))
    expect(screen.getByText('Close menu')).toBeTruthy()
    state.query = 'audience=intranet&site=default'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
  })
  it('sends signed-out protected pages to login but leaves the login route alone', () => {
    state.user = null
    state.pathname = '/admin/crm'
    const view = render(<Policy />)
    expect(state.login).toHaveBeenCalledWith('/admin', '/login')
    state.login.mockClear()
    state.pathname = '/admin/login'
    view.rerender(<Policy />)
    expect(state.login).not.toHaveBeenCalled()
  })
})
