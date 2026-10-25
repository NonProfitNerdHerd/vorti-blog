// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminSiteProvider, AdminSiteSwitcher } from '../../src/organizations/AdminSiteProvider'
import { siteLabel, siteURL } from '../../src/organizations/admin-site'
import { dashboardRequestPath } from '../../src/dashboard/workspace-model'

const mocks = vi.hoisted(() => ({ push: vi.fn(), user: { id: 1 }, path: '/admin' }))
vi.mock('@payloadcms/ui', () => ({
  ActionsProvider: ({
    Actions,
    children,
  }: {
    Actions: Record<string, import('react').ReactNode>
    children: import('react').ReactNode
  }) => (
    <>
      {Object.entries(Actions).map(([key, node]) => <div key={key}>{node}</div>)}
      {children}
    </>
  ),
  AppHeader: () => <header aria-label="Admin header" />,
  useAuth: () => ({ user: mocks.user }),
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/admin' } } }),
}))
vi.mock('../../src/organizations/admin-site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/organizations/admin-site')>()),
  navigateAdminSite: mocks.push,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
const sites = [
  { id: 'default', name: 'Main', parent_id: null },
  { id: 'child', name: 'Local', parent_id: 'default' },
]
let transport: ReturnType<typeof vi.fn>,
  deny = false,
  preference = 'default'
beforeEach(() => {
  deny = false
  preference = 'default'
  mocks.push.mockClear()
  window.history.replaceState({}, '', '/admin?site=default')
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  transport = vi.fn(
    async (_url: unknown, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === 'POST'
            ? { doc: { revision: 8 } }
            : { sites, next: null, context: { site: preference, revision: 7 } },
        ),
        { status: deny && options?.method === 'POST' ? 403 : 200 },
      ),
  )
  window.fetch = transport as typeof fetch
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
async function setup() {
  render(
    <AdminSiteProvider>
      <AdminSiteSwitcher />
      <input aria-label="Unsaved title" defaultValue="Keep this" />
    </AdminSiteProvider>,
  )
  return (await screen.findByRole('combobox', {
    name: 'Current site',
  })) as unknown as HTMLSelectElement
}
it('switches through the revision-checked service to the chosen dashboard', async () => {
  const select = await setup()
  fireEvent.change(select, { target: { value: 'child' } })
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin?site=child'))
  const write = transport.mock.calls.find((call) => call[1]?.method === 'POST')!
  expect(JSON.parse(String(write[1]?.body))).toMatchObject({
    action: 'context',
    site: 'child',
    expectedRevision: 7,
  })
})
it('cancels a switch without changing the site, writing preferences, or losing input', async () => {
  const select = await setup(),
    guard = (event: Event) => event.preventDefault()
  window.addEventListener('beforeunload', guard)
  try {
    fireEvent.change(select, { target: { value: 'child' } })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stay on this page' }))
    expect(select.value).toBe('default')
    expect((screen.getByLabelText('Unsaved title') as HTMLInputElement).value).toBe('Keep this')
    expect(transport.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false)
    expect(mocks.push).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('beforeunload', guard)
  }
})
it('confirms guarded switches and retains the old page on revoked access', async () => {
  const select = await setup(),
    guard = (event: Event) => event.preventDefault()
  window.addEventListener('beforeunload', guard)
  deny = true
  try {
    fireEvent.change(select, { target: { value: 'child' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))
    await screen.findByRole('alert')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(select.value).toBe('default')
    expect((screen.getByLabelText('Unsaved title') as HTMLInputElement).value).toBe('Keep this')
  } finally {
    window.removeEventListener('beforeunload', guard)
  }
})
it('pins native requests to this page even when another tab changes the preference', async () => {
  await setup()
  preference = 'child'
  await window.fetch('/api/posts')
  const call = transport.mock.calls.at(-1)!
  expect(new Headers(call[1]?.headers).get('x-vorticause-site')).toBe('default')
  await window.fetch('https://external.example.test/api/posts')
  expect(transport.mock.calls.at(-1)![1]).toBeUndefined()
})

it('validates an explicitly opened site independently of a different saved preference', async () => {
  preference = 'child'
  await setup()
  const initial = transport.mock.calls[0]
  expect(new Headers(initial[1]?.headers).get('x-vorticause-site')).toBe('default')
  expect(
    (screen.getByRole('combobox', { name: 'Current site' }) as unknown as HTMLSelectElement).value,
  ).toBe('default')
})
it('does not fall back when an explicit site is unavailable', async () => {
  window.history.replaceState({}, '', '/admin?site=revoked')
  render(
    <AdminSiteProvider>
      <AdminSiteSwitcher />
    </AdminSiteProvider>,
  )
  await screen.findByText(/This site is unavailable/)
  expect(screen.queryByRole('combobox')).toBeNull()
})
it('uses a noninteractive label for a single accessible site', async () => {
  transport.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          sites: [sites[0]],
          next: null,
          context: { site: 'default', revision: 1 },
        }),
      ),
  )
  render(
    <AdminSiteProvider>
      <AdminSiteSwitcher />
    </AdminSiteProvider>,
  )
  await screen.findByLabelText('Current site')
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('lets a new child-only user explicitly choose a first site without mounting default-site content', async () => {
  window.history.replaceState({}, '', '/admin')
  transport.mockImplementation(
    async (_url: unknown, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === 'POST'
            ? { doc: { revision: 1 } }
            : { sites: [sites[1]], next: null, context: { site: 'default', revision: 0 } },
        ),
      ),
  )
  render(
    <AdminSiteProvider>
      <input aria-label="Default-site content" />
    </AdminSiteProvider>,
  )
  const select = await screen.findByRole('combobox', { name: 'Current site' })
  expect(screen.queryByLabelText('Default-site content')).toBeNull()
  fireEvent.change(select, { target: { value: 'child' } })
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin?site=child'))
})
it('preserves explicit targets and external/auth links while scoping child settings', () => {
  expect(siteURL('/admin/collections/posts/create', 'child', '/admin', 'https://app.test')).toBe(
    '/admin/collections/posts/create?site=child',
  )
  expect(siteURL('/admin?site=default', 'child', '/admin', 'https://app.test')).toBe(
    '/admin?site=default',
  )
  expect(siteURL('/admin/globals/site-settings', 'child', '/admin', 'https://app.test')).toBe(
    '/admin/globals/site-settings?site=child&tab=SubSites',
  )
  expect(siteURL('https://other.test/admin', 'child', '/admin', 'https://app.test')).toBe(
    'https://other.test/admin',
  )
  expect(siteURL('/admin/logout', 'child', '/admin', 'https://app.test')).toBe('/admin/logout')
  expect(siteLabel(sites[1], sites)).toBe('Main → Local')
})
it('scopes dashboard workspace counts without restricting personal tasks', () => {
  const path = dashboardRequestPath(
    'task-projects/count?where={"archived":{"not_equals":true}}',
    'child',
  )
  const where = JSON.parse(new URLSearchParams(path.split('?')[1]).get('where')!)
  expect(where.and[1].or).toEqual([
    { platformSite: { equals: 'child' } },
    { platformSite: { exists: false } },
  ])
  expect(dashboardRequestPath('review-tasks?limit=5', 'child')).toBe('review-tasks?limit=5')
})

it('disambiguates identically named siblings without revealing inaccessible ancestors', () => {
  const duplicate = { ...sites[1], id: 'second', route_key: 'local-two' }
  expect(siteLabel(duplicate, [...sites, duplicate])).toBe('Main → Local (local-two)')
  expect(siteLabel({ ...duplicate, parent_id: 'private-parent' }, [duplicate])).toBe('Local')
})
