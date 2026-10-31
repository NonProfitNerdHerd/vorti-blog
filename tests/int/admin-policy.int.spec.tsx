// DOM environment is selected by the dom Vitest project.
import { createContext, useContext } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pathname: '/admin',
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
  useSearchParams: () => new URLSearchParams(),
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
function Controls() {
  const { navOpen, setNavOpen } = useContext(TestNav)
  return <button onClick={() => setNavOpen(!navOpen)}>{navOpen ? 'Close menu' : 'Open menu'}</button>
}
function Policy() {
  return <AdminPolicyClient initialCategoriesEnabled><Controls /></AdminPolicyClient>
}
afterEach(() => {
  cleanup()
  state.pathname = '/admin'
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
