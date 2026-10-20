import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { OrganizationRepository } from '../../src/organizations/repository'
import { atomicSiteMutation, SiteConflictError } from '../../src/organizations/atomic'

/** Uses an ephemeral workerd-backed database with no remote bindings or shared dev state. */
describe('organization writes on actual local D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>
  let db: D1Database
  beforeAll(async () => {
    proxy = await getPlatformProxy<{ D1: D1Database }>({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    db = proxy.env.D1
    await db.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT)').run()
    await db.prepare("INSERT INTO users VALUES(1,'administrator'),(2,'editor')").run()
    for (const sql of [...organizationSchema, ...defaultOrganizationSeed])
      await db.prepare(sql).run()
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('rolls back stale writes and rejects audit updates under workerd', async () => {
    const op = 'd1_atomic_operation_12345'
    const mutation = {
      actor: 1,
      operationKey: op,
      fingerprint: 'a'.repeat(64),
      result: { revision: 2 },
      write: db.prepare(
        "UPDATE vc_sites SET revision=revision+1 WHERE id='default' AND revision=1",
      ),
      afterWrite: [
        db
          .prepare(
            "INSERT INTO vc_platform_audit(id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES('audit-d1',1,'test','site','default',?,'now')",
          )
          .bind(op),
      ],
    }
    await atomicSiteMutation(db, mutation)
    await expect(
      atomicSiteMutation(db, { ...mutation, operationKey: 'd1_stale_operation_12345' }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect(
      (
        await db
          .prepare("SELECT revision FROM vc_sites WHERE id='default'")
          .first<{ revision: number }>()
      )?.revision,
    ).toBe(2)
    expect(
      (await db.prepare('SELECT count(*) AS n FROM vc_platform_audit').first<{ n: number }>())?.n,
    ).toBe(1)
    await expect(db.prepare("UPDATE vc_platform_audit SET action='forged'").run()).rejects.toThrow(
      'append-only',
    )
  })
  it('deduplicates concurrent creates and records the site hierarchy', async () => {
    const repository = new OrganizationRepository(db, 1)
    const input = {
      name: 'Fictional workerd network',
      siteName: 'National',
      operationKey: 'd1_create_network_123456',
    }
    const results = await Promise.all([
      repository.createOrganization(input),
      repository.createOrganization(input),
    ])
    expect(results[0]).toEqual(results[1])
    const child = await repository.createSite({
      parent: results[0].site as string,
      name: 'Local',
      expectedRevision: 1,
      operationKey: 'd1_create_local_12345678',
    })
    expect(
      (
        await db
          .prepare('SELECT distance FROM vc_site_ancestry WHERE ancestor_id=? AND descendant_id=?')
          .bind(results[0].site, child.site)
          .first<{ distance: number }>()
      )?.distance,
    ).toBe(1)
    expect(
      (await new OrganizationRepository(db, 2).authority(child.site as string, 'finances', 'read'))
        .allowed,
    ).toBe(false)
  })
  it('rejects an edit if authority is revoked after evaluation but before its batch', async () => {
    const before = await db.prepare('SELECT count(*) AS n FROM vc_sites').first<{ n: number }>()
    const fenced = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        await db.prepare('DELETE FROM vc_installation_operators WHERE user_id=1').run()
        return db.batch(statements)
      },
    } as unknown as D1Database
    await expect(
      new OrganizationRepository(fenced, 1).createSite({
        parent: 'default',
        name: 'Must not commit',
        expectedRevision: 2,
        operationKey: 'd1_revoked_race_123456',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect((await db.prepare('SELECT count(*) AS n FROM vc_sites').first<{ n: number }>())?.n).toBe(
      before?.n,
    )
    expect(
      await db
        .prepare('SELECT id FROM vc_platform_audit WHERE operation_key=?')
        .bind('d1_revoked_race_123456')
        .first(),
    ).toBeNull()
  })
})
