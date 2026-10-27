import { beforeEach, expect, it, vi } from 'vitest'
import { SettingsHub } from '../../src/components/SettingsHub'
import { TenantPermissionError } from '../../src/organizations/tenant-repository'

const mocks = vi.hoisted(() => ({ read: vi.fn(), require: vi.fn() }))
vi.mock('../../src/components/SettingsHubClient', () => ({ SettingsHubClient: (): null => null }))
vi.mock('../../src/components/TenantSettingsHub', () => ({ TenantSettingsHub: (): null => null }))
vi.mock('../../src/organizations/cms-scope', () => ({ cmsDatabase: () => ({}) }))
vi.mock('../../src/organizations/tenant-runtime', () => ({
  tenantAuthorityActive: async () => true,
}))
vi.mock('../../src/organizations/identity-authority', () => ({
  claimRequest: async () => ({ tenantAdministrator: false }),
}))
vi.mock('../../src/organizations/scoped-settings', () => ({
  ScopedSettingsRepository: class {
    read = mocks.read
  },
}))
vi.mock('../../src/organizations/tenant-repository', () => ({
  TenantPermissionError: class extends Error {},
  TenantRepository: class {
    require = mocks.require
  },
}))
const props = {
  user: { id: 1 },
  initPageResult: {
    req: { url: 'https://example.com/admin/globals/system-settings?site=chapter&section=features' },
  },
}
beforeEach(() => {
  vi.resetAllMocks()
})
it('loads the saved Categories value and current revision on Features', async () => {
  mocks.read.mockResolvedValue({ settings: { categoriesEnabled: true }, revision: 7 })
  const view = await SettingsHub(props as never)
  expect(view.props.initial).toEqual({ categoriesEnabled: true })
  expect(view.props.initialRevision).toBe(7)
  expect(mocks.read).toHaveBeenCalledWith('chapter')
  expect(mocks.require).toHaveBeenCalledWith('chapter', 'administration:features')
})
it('keeps feature-only managers authorized without exposing Settings values', async () => {
  mocks.read.mockRejectedValue(new TenantPermissionError())
  const view = await SettingsHub(props as never)
  expect(view.props.initial).toEqual({})
})
it('does not hide database failures as missing Settings permission', async () => {
  mocks.read.mockRejectedValue(new Error('Database unavailable'))
  await expect(SettingsHub(props as never)).rejects.toThrow('Database unavailable')
})
