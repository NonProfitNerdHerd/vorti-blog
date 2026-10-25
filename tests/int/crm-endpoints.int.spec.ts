import type { Config, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { crmModule } from '../../src/crm/plugin'

const config = crmModule({ db: {} as D1Database, storage: {} as R2Bucket })({} as Config)
describe('CRM endpoint authentication and mutation boundaries', () => {
  it('reports pending migrations without exposing raw database errors', async () => {
    const pending = crmModule({ db: { prepare() { throw new Error('D1_ERROR: no such table: vc_sites: SQLITE_ERROR') } } as unknown as D1Database, storage: {} as R2Bucket })({} as Config)
    const endpoint = pending.endpoints!.find(value => value.path === '/crm/context')!
    const response = await endpoint.handler({ user: { id: 1, collection: 'users' } } as PayloadRequest)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).not.toContain('vc_sites')
  })
  it('rejects anonymous access to every endpoint before touching persistence', async () => {
    for (const endpoint of config.endpoints || []) {
      const response = await endpoint.handler({} as PayloadRequest)
      expect(response.status).toBe(endpoint.path === '/crm/jobs/tick' ? 403 : 401)
    }
  })
  it('rejects foreign-origin state changes even with an authenticated account', async () => {
    const endpoint = config.endpoints!.find(
      (value) => value.path === '/crm/contacts' && value.method === 'post',
    )!
    const response = await endpoint.handler({
      user: { id: 1, collection: 'users' },
      url: 'https://admin.example.invalid/api/crm/contacts',
      headers: new Headers({ origin: 'https://foreign.example.invalid' }),
    } as PayloadRequest)
    expect(response.status).toBe(403)
  })
  it('rejects unsupported actions and oversized requests without database access', async () => {
    const endpoint = config.endpoints!.find(
      (value) => value.path === '/crm/contacts' && value.method === 'post',
    )!
    const request = (body: unknown): PayloadRequest => {
      const incoming = new Request('https://admin.example.invalid/api/crm/contacts', {
        method: 'POST',
        headers: { origin: 'https://admin.example.invalid', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return {
        user: { id: 1, collection: 'users' },
        url: incoming.url,
        headers: incoming.headers,
        body: incoming.body,
      } as PayloadRequest
    }
    expect(
      (
        await endpoint.handler(
          request({ action: 'grant-operator', actor: 1, installationOperator: true }),
        )
      ).status,
    ).toBe(400)
    expect(
      (await endpoint.handler(request({ action: 'create', profile: 'x'.repeat(33000) }))).status,
    ).toBe(413)
  })
})
