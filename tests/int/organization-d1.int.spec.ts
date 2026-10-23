import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { OrganizationRepository } from '../../src/organizations/repository'
import { atomicSiteMutation, SiteConflictError } from '../../src/organizations/atomic'
import { guardedMutations, nativeMutationSchemaV1, nativeMutationGuardsV1 } from '../../src/organizations/mutation-guards'
import { guardedGlobals, globalSettingsGuards } from '../../src/organizations/site-settings'
import { nativeUserAuthenticationGuardsV2 } from '../../src/organizations/mutation-guards'

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
    await db.prepare("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'").run()
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('rejects revoked global inserts and updates on actual D1', async () => {
    for (const table of guardedGlobals) await db.prepare(`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY,value TEXT,platform_global_proof TEXT)`).run()
    for (const statement of globalSettingsGuards) await db.prepare(statement).run()
    const row = await db.prepare("SELECT authority_revision AS epoch FROM vc_organizations WHERE id='default'").first<{ epoch: number }>()
    const proof = JSON.stringify({ actor: 1, epoch: row!.epoch, nonce: 'server-proof' })
    for (const table of guardedGlobals) await db.prepare(`INSERT INTO "${table}" VALUES(1,'original',?)`).bind(proof).run()
    await db.prepare("UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id='default'").run()
    for (const table of guardedGlobals) {
      await expect(db.prepare(`UPDATE "${table}" SET value='stale',platform_global_proof=? WHERE id=1`).bind(proof).run()).rejects.toThrow('Global authority changed')
      await expect(db.prepare(`INSERT INTO "${table}" VALUES(2,'stale',?)`).bind(proof).run()).rejects.toThrow('Global authority changed')
    }
  })
  it('rejects revoked native writes and draft versions on actual D1', async () => {
    const setup = [...nativeMutationSchemaV1]
    const tables: string[] = []
    for (const [, table, versions] of guardedMutations) {
      tables.push(table === 'users' ? 'ALTER TABLE users ADD COLUMN platform_mutation_proof TEXT' : `CREATE TABLE "${table}"(id INTEGER PRIMARY KEY,platform_mutation_proof TEXT,value TEXT,updated_at TEXT,membership_revision INTEGER DEFAULT 0)`)
      if (versions) tables.push(`CREATE TABLE "${versions}"(id INTEGER PRIMARY KEY,version_platform_mutation_proof TEXT)`)
    }
    for (const statements of [setup, tables, [...nativeMutationGuardsV1]]) {
      for (let offset = 0; offset < statements.length; offset += 40)
        await db.batch(statements.slice(offset, offset + 40).map(sql => db.prepare(sql)))
    }
    const epoch = (await db.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").first<{ authority_revision: number }>())!.authority_revision
    const proof = JSON.stringify({ actor: 2, site: 'default', epoch })
    await db.prepare('INSERT INTO form_submissions(id,platform_mutation_proof,value) VALUES(1,?,?)').bind(proof, 'Original').run()
    await db.prepare("UPDATE vc_site_memberships SET active=0 WHERE site_id='default' AND user_id=2").run()
    await expect(db.batch([
      db.prepare("UPDATE form_submissions SET value='Forbidden',platform_mutation_proof=? WHERE id=1").bind(proof),
      db.prepare("INSERT INTO vc_platform_audit(id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES('forbidden-proof',2,'test','form','1','forbidden-proof-operation','now')"),
    ])).rejects.toThrow('authority changed')
    await expect(db.prepare('INSERT INTO _forms_v(id,version_platform_mutation_proof) VALUES(1,?)').bind(proof).run()).rejects.toThrow('authority changed')
    expect((await db.prepare('SELECT value FROM form_submissions WHERE id=1').first<{ value: string }>())?.value).toBe('Original')
    expect(await db.prepare("SELECT 1 FROM vc_platform_audit WHERE id='forbidden-proof'").first()).toBeNull()
    await db.prepare("UPDATE vc_site_memberships SET active=1 WHERE site_id='default' AND user_id=2").run()
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
    await db.prepare('UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id=?').bind(results[0].site).run()
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
  it('preserves authentication upserts while rejecting stale account edits on actual D1', async () => {
    await db.prepare('ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0').run()
    const columns = (await db.prepare('PRAGMA table_info(users)').all<{ name: string }>()).results.map(row => row.name)
    for (const statement of nativeUserAuthenticationGuardsV2(columns)) await db.prepare(statement).run()
    const epoch = (await db.prepare("SELECT authority_revision AS epoch FROM vc_organizations WHERE id='default'").first<{ epoch: number }>())!.epoch
    const proof = JSON.stringify({ actor: 1, site: 'default', epoch })
    await db.prepare('UPDATE users SET platform_mutation_proof=? WHERE id=1').bind(proof).run()
    await db.prepare("UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id='default'").run()
    await db.prepare("INSERT INTO users(id,role,platform_mutation_proof,login_attempts) VALUES(1,'administrator',?,2) ON CONFLICT(id) DO UPDATE SET role=excluded.role,platform_mutation_proof=excluded.platform_mutation_proof,login_attempts=excluded.login_attempts").bind(proof).run()
    expect((await db.prepare('SELECT login_attempts AS n FROM users WHERE id=1').first<{ n: number }>())?.n).toBe(2)
    await expect(db.prepare("UPDATE users SET role='editor',platform_mutation_proof=? WHERE id=1").bind(proof).run()).rejects.toThrow('Mutation authority changed')
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
