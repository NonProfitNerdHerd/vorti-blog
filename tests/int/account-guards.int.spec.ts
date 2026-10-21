import type { Config, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import {
  accountStatusGuards,
  requireActiveAccount,
  PLATFORM_MIGRATION,
} from '../../src/organizations/account-guards'

function fixture() {
  let disabled = 0,
    calls = 0
  const db = {
    prepare: () => ({ bind: () => ({ first: async () => ({ disabled }) }) }),
  } as unknown as D1Database
  const config = accountStatusGuards(db)({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'posts', fields: [] },
    ],
    globals: [{ slug: 'site-settings', fields: [] }],
    endpoints: [
      {
        path: '/test',
        method: 'get',
        handler: async () => {
          calls++
          return Response.json({ ok: true })
        },
      },
    ],
  } as unknown as Config)
  return {
    config,
    db,
    disable: () => {
      disabled = 1
    },
    calls: () => calls,
  }
}
describe('request-time retained-account deactivation', () => {
  it('checks current storage rather than a signed-in role or stale session object', async () => {
    const { db, disable } = fixture(),
      actor = { id: 1, role: 'administrator' }
    await expect(requireActiveAccount(db, actor)).resolves.toBeUndefined()
    disable()
    await expect(requireActiveAccount(db, actor)).rejects.toMatchObject({ status: 403 })
  })
  it('protects custom endpoints before handlers run', async () => {
    const { config, disable, calls } = fixture(),
      req = { user: { id: 1, role: 'administrator' } } as PayloadRequest
    expect((await config.endpoints![0].handler(req)).status).toBe(200)
    disable()
    await expect(config.endpoints![0].handler(req)).rejects.toMatchObject({ status: 403 })
    expect(calls()).toBe(1)
  })
  it('runs for native/Local API collection operations even when access is overridden', async () => {
    const { config, disable } = fixture()
    disable()
    const hook = config.collections!.find((collection) => collection.slug === 'posts')!.hooks!
      .beforeOperation![0]
    await expect(
      hook({
        req: { user: { id: 1 } },
        args: { overrideAccess: true },
        operation: 'read',
        } as unknown as Parameters<typeof hook>[0]),
    ).rejects.toMatchObject({ status: 403 })
    const login = config.collections![0].hooks!.beforeLogin![0]
    await expect(login({ user: { id: 1 } } as Parameters<typeof login>[0])).rejects.toMatchObject({
      status: 403,
    })
  })
  it('protects globals and leaves anonymous public access decisions to their normal access rules', async () => {
    const { config, db, disable } = fixture()
    await expect(requireActiveAccount(db, null)).resolves.toBeUndefined()
    disable()
    const read = config.globals![0].hooks!.beforeRead![0],
      update = config.globals![0].hooks!.beforeChange![0]
    await expect(
      read({ req: { user: { id: 1 } } } as Parameters<typeof read>[0]),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      update({ req: { user: { id: 1 } }, data: {} } as Parameters<typeof update>[0]),
    ).rejects.toMatchObject({ status: 403 })
  })
  it('permits fresh native bootstrap but fails closed for a partial authority migration', async () => {
    let installed = false
    const db = {
      prepare: (sql: string) =>
        sql.includes('sqlite_master')
          ? { first: async () => (installed ? { name: 'vc_organizations' } : null) }
          : {
              bind: () => ({
                first: async (): Promise<never> => {
                  throw new Error('no such table: vc_account_status')
                },
              }),
            },
    } as unknown as D1Database
    await expect(requireActiveAccount(db, { id: 1 })).resolves.toBeUndefined()
    installed = true
    await expect(requireActiveAccount(db, { id: 1 })).rejects.toMatchObject({ status: 503 })
  })
  it('accepts only server-owned migration context, never a JSON lookalike', async () => {
    const { config, disable } = fixture()
    disable()
    const hook = config.collections![1].hooks!.beforeOperation![0]
    await expect(
      hook({
        req: { user: { id: 1 }, context: { 'trusted-platform-migration': true } },
        operation: 'read',
        args: {},
        } as unknown as Parameters<typeof hook>[0]),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      hook({
        req: { user: { id: 1 }, context: { [PLATFORM_MIGRATION]: true } },
        operation: 'read',
        args: {},
      } as unknown as Parameters<typeof hook>[0]),
    ).resolves.toBeUndefined()
  })
})
