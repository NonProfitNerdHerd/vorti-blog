// DOM environment is selected by the dom Vitest project.
import { createContext, useContext } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pathname: '/admin',
  mobile: false,
  save: vi.fn().mockResolvedValue(undefined),
  native: vi.fn(),
  replace: vi.fn(),
}))
const TestNav = createContext({ navOpen: false, setNavOpen: (_open: boolean) => {} })
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace, refresh: vi.fn() }),
}))
vi.mock('@payloadcms/ui', () => ({
  NavContext: TestNav,
  useNav: () => ({ navOpen: true, setNavOpen: state.native, hydrated: true }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
  toast: { error: vi.fn() },
  useWindowInfo: () => ({ breakpoints: { l: state.mobile } }),
  useAuth: () => ({ user: { role: 'administrator' } }),
}))
vi.mock('@design-system/payload-design-core/admin', () => ({
  CategoriesEnabledProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/sidebar-preferences', () => ({ saveDashboardSidebar: state.save }))
const { AdminPolicyClient } = await import('@/components/AdminPolicyClient')
function Controls() {
  const { navOpen, setNavOpen } = useContext(TestNav)
  return (
    <button onClick={() => setNavOpen(!navOpen)}>{navOpen ? 'Close menu' : 'Open menu'}</button>
  )
}
function Policy({ open = true }: { open?: boolean }) {
  return (
    <AdminPolicyClient initialCategoriesEnabled initialDashboardOpen={open}>
      <Controls />
    </AdminPolicyClient>
  )
}
afterEach(() => {
  cleanup()
  state.pathname = '/admin'
  state.mobile = false
  vi.clearAllMocks()
})
describe('Admin sidebar policy', () => {
  it('remembers dashboard changes separately from default closed pages and query changes', async () => {
    const view = render(<Policy />)
    fireEvent.click(screen.getByText('Close menu'))
    await waitFor(() => expect(state.save).toHaveBeenCalledWith('/api', false))
    state.pathname = '/admin/collections/posts'
    view.rerender(<Policy />)
    fireEvent.click(screen.getByText('Open menu'))
    view.rerender(<Policy />) // URL queries leave usePathname unchanged.
    expect(screen.getByText('Close menu')).toBeTruthy()
    state.pathname = '/admin/collections/pages'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    state.pathname = '/admin/collections/posts'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    state.pathname = '/admin'
    view.rerender(<Policy />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    expect(state.save).toHaveBeenCalledTimes(1)
  })
  it('restores a closed dashboard and closes mobile navigation on route and breakpoint changes', () => {
    const view = render(<Policy open={false} />)
    expect(screen.getByText('Open menu')).toBeTruthy()
    state.mobile = true
    view.rerender(<Policy open={false} />)
    fireEvent.click(screen.getByText('Open menu'))
    expect(state.save).not.toHaveBeenCalled()
    state.pathname = '/admin/collections/posts'
    view.rerender(<Policy open={false} />)
    expect(screen.getByText('Open menu')).toBeTruthy()
  })
})
