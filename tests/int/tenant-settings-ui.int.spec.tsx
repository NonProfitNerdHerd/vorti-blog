// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TenantSettingsHub } from '../../src/components/TenantSettingsHub'
vi.mock('@payloadcms/ui', () => ({ useConfig: () => ({ config: { routes: { api: '/api' } } }) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const initial = {
  siteName: 'Main',
  siteTagline: '',
  timezone: 'UTC',
  dateFormat: 'long',
  timeFormat: '12',
  categoriesEnabled: true,
}
it('retains a conflicting settings draft, protects navigation, and preserves explicit site URLs', async () => {
  vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? Response.json({ message: 'Conflict' }, { status: 409 })
      : Response.json({ docs: [] }),
  )
  render(
    <TenantSettingsHub
      site="chapter"
      section="general"
      initial={initial}
      initialRevision={3}
      tenantAdministrator={false}
    />,
  )
  fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Retained draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect((await screen.findByRole('alert')).textContent).toContain('draft is retained')
  expect((screen.getByLabelText('Site name') as HTMLInputElement).value).toBe('Retained draft')
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  expect(screen.getByRole('link', { name: 'Roles' }).getAttribute('href')).toBe(
    '?site=chapter&section=roles',
  )
})
it('renders built-in role permissions read-only with one named control per permission', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      revision: 10,
      members: [], assignments: [], scopes: ['default'], tenantScope: true,
      roles: [
        {
          id: 'admin',
          name: 'Tenant Administrator',
          description: 'Tenant scope',
          builtin: 'tenant-administrator',
          retired: 0,
          permissions: ['tasks:read'],
        },
      ],
    }),
  )
  render(
    <TenantSettingsHub
      site="default"
      section="roles"
      initial={initial}
      initialRevision={0}
      tenantAdministrator
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Tenant Administrator' }))
  const input = screen.getByRole('checkbox', { name: 'tasks:read' }) as HTMLInputElement
  expect(input.checked).toBe(true)
  expect(input.closest('fieldset')?.disabled).toBe(true)
  expect(screen.getAllByRole('checkbox', { name: 'tasks:read' })).toHaveLength(1)
})
it('explains tenant-controlled feature locks and shows effective availability', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      revision: 5,
      features: [
        {
          feature: 'tasks',
          tenantAvailable: false,
          available: false,
          configured: 'enabled',
          controllingScope: 'tenant-a',
          locked: true,
        },
      ],
    }),
  )
  render(
    <TenantSettingsHub
      site="chapter"
      section="features"
      initial={initial}
      initialRevision={0}
      tenantAdministrator={false}
    />,
  )
  expect(
    ((await screen.findByRole('combobox', { name: 'tasks site setting' })) as unknown as HTMLSelectElement)
      .disabled,
  ).toBe(true)
  expect(screen.getByText('Disabled by the tenant. A site cannot enable it.')).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: 'tasks tenant availability' })).toBeNull()
})
