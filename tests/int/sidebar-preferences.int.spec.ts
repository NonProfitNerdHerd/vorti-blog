import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveDashboardSidebar } from '@/components/sidebar-preferences'

afterEach(() => vi.unstubAllGlobals())
describe('Dashboard preference persistence', () => {
  it('creates a preference through the normal collection API when none exists', async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', network)
    await saveDashboardSidebar('/api', false)
    expect(network.mock.calls[1][0]).toBe('/api/payload-preferences?depth=0')
    expect(network.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(network.mock.calls[1][1].body)).toEqual({
      key: 'vorti-dashboard-sidebar',
      value: { open: false },
    })
  })
  it('updates the existing preference and reports failed writes', async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 8 }) })
      .mockResolvedValueOnce({ ok: false })
    vi.stubGlobal('fetch', network)
    await expect(saveDashboardSidebar('/custom-api', true)).rejects.toThrow('Could not save')
    expect(network.mock.calls[1][0]).toBe('/custom-api/payload-preferences/8?depth=0')
    expect(network.mock.calls[1][1].method).toBe('PATCH')
  })
})
