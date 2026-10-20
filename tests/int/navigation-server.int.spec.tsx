import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@payloadcms/next/client', () => ({ NavHamburger: () => <span />, NavWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@payloadcms/ui', () => ({ Logout: () => <span /> }))
vi.mock('@payloadcms/ui/shared', () => ({ EntityType: { collection: 'collections', global: 'globals' }, groupNavItems: () => [{ label: 'Content', entities: [] as never[] }, { label: 'Site Design', entities: [] as never[] }, { label: 'Review', entities: [] as never[] }] }))
vi.mock('../../src/components/DashboardNavLink', () => ({ PolicyNav: ({ navPreferences }: { navPreferences: { groups: Record<string, { open?: boolean }> } }) => <div>{navPreferences.groups.Tasks?.open === undefined ? 'unset' : navPreferences.groups.Tasks.open ? 'open' : 'closed'}</div> }))
import { SiteDesignNav } from '../../src/components/SiteDesignNav'

describe('navigation server preferences', () => {
  it('reads the signed-in user preference without a request object on Workers', async () => {
    const user = { id: 8, role: 'designer' }
    const find = vi.fn().mockResolvedValue({ docs: [{ value: { groups: { Tasks: { open: false } } } }] })
    const markup = renderToStaticMarkup(await SiteDesignNav({ user, payload: { config: { collections: [] as never[], globals: [] as never[], admin: { user: 'users' }, routes: { admin: '/admin' } }, find }, visibleEntities: { collections: [] as never[], globals: [] as never[] }, permissions: {}, i18n: {} } as never))
    expect(markup).toContain('>closed<')
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ user, overrideAccess: false, where: { and: [{ key: { equals: 'nav' } }, { 'user.relationTo': { equals: 'users' } }, { 'user.value': { equals: 8 } }] } }))
    expect(find.mock.calls[0][0]).not.toHaveProperty('req')
  })
})
