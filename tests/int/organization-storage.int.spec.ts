import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultOrganizationSeed, organizationSchema } from '../../src/organizations/schema'
import { atomicSiteMutation, SiteConflictError } from '../../src/organizations/atomic'
import { OrganizationRepository, SiteAccessError } from '../../src/organizations/repository'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  sqlite.exec(
    `PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'),(2,'designer'),(3,'editor'); CREATE TABLE legacy_posts(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO legacy_posts VALUES(7,'Retain historical content');`,
  )
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed]) sqlite.exec(sql)
  class Statement {
    values: Array<string | number | null> = []
    constructor(readonly sql: string) {}
    bind(...values: Array<string | number | null>) {
      this.values = values
      return this
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) || null
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values) }
    }
    run() {
      return sqlite.prepare(this.sql).run(...this.values)
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map((statement) => statement.run())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  const mutation = (key = 'operation_1234567890') => ({
    actor: 1,
    operationKey: key,
    fingerprint: 'a'.repeat(64),
    result: { site: 'default', revision: 2 },
    write: db
      .prepare('UPDATE vc_sites SET name=?,revision=revision+1 WHERE id=? AND revision=?')
      .bind('New name', 'default', 1),
    afterWrite: [
      db
        .prepare(
          'INSERT INTO vc_platform_audit(id,site_id,actor_id,action,record_type,record_id,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          'audit-1',
          'default',
          1,
          'site.updated',
          'site',
          'default',
          key,
          '2026-10-20T00:00:00Z',
        ),
    ],
  })
  return { sqlite, db, mutation }
}
describe('organization storage SQL and atomic writes', () => {
  it('is additive and seed-repeat safe without claiming personal records', () => {
    const { sqlite } = fixture()
    for (const sql of [...organizationSchema, ...defaultOrganizationSeed]) sqlite.exec(sql)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_sites').get()?.n).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_installation_operators').get()?.n).toBe(1)
    expect(sqlite.prepare('SELECT role FROM vc_site_memberships WHERE user_id=2').get()?.role).toBe(
      'editor',
    )
    expect(sqlite.prepare('SELECT title FROM legacy_posts WHERE id=7').get()?.title).toBe(
      'Retain historical content',
    )
  })
  it('commits the edit and audit once, returning the same result for a replay', async () => {
    const { sqlite, db, mutation } = fixture()
    await expect(atomicSiteMutation(db, mutation())).resolves.toEqual({
      site: 'default',
      revision: 2,
    })
    await atomicSiteMutation(db, mutation())
    expect(sqlite.prepare('SELECT revision FROM vc_sites').get()?.revision).toBe(2)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_write_guards').get()?.n).toBe(0)
  })
  it('rolls back stale updates, dependent writes and audit', async () => {
    const { sqlite, db, mutation } = fixture()
    sqlite.exec('UPDATE vc_sites SET revision=3')
    await expect(atomicSiteMutation(db, mutation())).rejects.toBeInstanceOf(SiteConflictError)
    expect(sqlite.prepare('SELECT name FROM vc_sites').get()?.name).toBe('Main site')
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(0)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_operations').get()?.n).toBe(0)
  })
  it('rolls back the edit if its audit fails and rejects operation-key substitution', async () => {
    const { sqlite, db, mutation } = fixture()
    const broken = mutation()
    broken.afterWrite = [db.prepare('INSERT INTO nonexistent_table VALUES(1)')]
    await expect(atomicSiteMutation(db, broken)).rejects.toThrow()
    expect(sqlite.prepare('SELECT revision FROM vc_sites').get()?.revision).toBe(1)
    await atomicSiteMutation(db, mutation())
    await expect(atomicSiteMutation(db, { ...mutation(), actor: 2 })).rejects.toBeInstanceOf(
      SiteConflictError,
    )
    await expect(
      atomicSiteMutation(db, { ...mutation(), fingerprint: 'b'.repeat(64) }),
    ).rejects.toBeInstanceOf(SiteConflictError)
  })
  it('blocks audit tampering at the database boundary', async () => {
    const { sqlite, db, mutation } = fixture()
    await atomicSiteMutation(db, mutation())
    expect(() => sqlite.exec("UPDATE vc_platform_audit SET action='forged'")).toThrow('append-only')
    expect(() => sqlite.exec('DELETE FROM vc_platform_audit')).toThrow('append-only')
  })
  it('rejects cross-root parent changes and cycles in direct SQL', () => {
    const { sqlite } = fixture()
    sqlite.exec(
      `INSERT INTO vc_organizations(id,name,created_at,updated_at) VALUES('other','Other','now','now'); INSERT INTO vc_sites(id,organization_id,name,route_key,created_at,updated_at) VALUES('other','other','Other','other','now','now'); INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES('child','default','default','Child','child','now','now'),('grandchild','default','child','Grandchild','grandchild','now','now')`,
    )
    expect(() => sqlite.exec("UPDATE vc_sites SET parent_id='other' WHERE id='child'")).toThrow(
      'Invalid site move',
    )
    expect(() =>
      sqlite.exec("UPDATE vc_sites SET parent_id='grandchild' WHERE id='child'"),
    ).toThrow('Invalid site move')
    expect(() => sqlite.exec("UPDATE vc_sites SET parent_id='child' WHERE id='default'")).toThrow(
      'Invalid site move',
    )
  })
  it('creates an isolated root and child with repeat-safe audited operations', async () => {
    const { sqlite, db } = fixture()
    const repository = new OrganizationRepository(db, 1)
    const root = await repository.createOrganization({
      name: 'Fictional Network',
      siteName: 'National',
      operationKey: 'create_network_123456',
    })
    const replay = await repository.createOrganization({
      name: 'Fictional Network',
      siteName: 'National',
      operationKey: 'create_network_123456',
    })
    expect(replay).toEqual(root)
    const child = await repository.createSite({
      parent: root.site as string,
      name: 'Regional',
      expectedRevision: 1,
      operationKey: 'create_region_1234567',
    })
    const childReplay = await repository.createSite({
      parent: root.site as string,
      name: 'Regional',
      expectedRevision: 1,
      operationKey: 'create_region_1234567',
    })
    expect(childReplay).toEqual(child)
    expect(
      sqlite
        .prepare('SELECT distance FROM vc_site_ancestry WHERE ancestor_id=? AND descendant_id=?')
        .get(root.site as string, child.site as string)?.distance,
    ).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(2)
    expect(
      (await new OrganizationRepository(db, 2).authority(child.site as string, 'finances', 'read'))
        .allowed,
    ).toBe(false)
  })
  it('rejects non-operator organization creation and stale site creation', async () => {
    const { sqlite, db } = fixture()
    await expect(
      new OrganizationRepository(db, 2).createOrganization({
        name: 'Forbidden',
        siteName: 'Forbidden',
        operationKey: 'forbidden_network_123',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    await expect(
      new OrganizationRepository(db, 1).createSite({
        parent: 'default',
        name: 'Stale',
        expectedRevision: 99,
        operationKey: 'stale_site_123456789',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_sites').get()?.n).toBe(1)
  })
  it('persists policy and advances authority fencing without granting non-operator overrides', async () => {
    const { sqlite, db } = fixture()
    const repository = new OrganizationRepository(db, 1)
    const child = await repository.createSite({
      parent: 'default',
      name: 'Local',
      expectedRevision: 1,
      operationKey: 'policy_child_12345678',
    })
    sqlite
      .prepare("INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES(?,3,'administrator')")
      .run(child.site as string)
    await repository.setPolicy({
      site: 'default',
      category: 'finances',
      operation: 'read',
      descendantsAllowed: false,
      overseeDescendants: false,
      expectedRevision: 2,
      operationKey: 'policy_root_123456789',
    })
    expect(
      sqlite.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').get('default')
        ?.authority_revision,
    ).toBe(8)
    expect(
      (await new OrganizationRepository(db, 3).authority(child.site as string, 'finances', 'read'))
        .reason,
    ).toBe('ancestor-constraint')
    await expect(
      new OrganizationRepository(db, 3).setPolicy({
        site: child.site as string,
        category: 'finances',
        operation: 'read',
        descendantsAllowed: true,
        overseeDescendants: true,
        expectedRevision: 1,
        operationKey: 'policy_override_12345',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
  })
  it('revokes site membership and prevents removal of its last administrator', async () => {
    const { sqlite, db } = fixture()
    const repository = new OrganizationRepository(db, 1)
    await repository.setMembership({
      site: 'default',
      user: 3,
      role: 'reader',
      active: false,
      expectedRevision: 1,
      operationKey: 'revoke_member_1234567',
    })
    expect(
      (await new OrganizationRepository(db, 3).authority('default', 'identity', 'read')).allowed,
    ).toBe(false)
    expect(
      sqlite.prepare('SELECT authority_revision FROM vc_organizations').get()?.authority_revision,
    ).toBe(6)
    await expect(
      repository.setMembership({
        site: 'default',
        user: 1,
        role: 'reader',
        active: true,
        expectedRevision: 2,
        operationKey: 'last_admin_123456789',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect(sqlite.prepare('SELECT role FROM vc_site_memberships WHERE user_id=1').get()?.role).toBe(
      'administrator',
    )
    expect(sqlite.prepare('SELECT revision FROM vc_sites').get()?.revision).toBe(2)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(1)
  })
  it('uses bounded joined pages rather than one query per ancestor', async () => {
    const { sqlite, db } = fixture()
    for (let index = 0; index < 120; index++) {
      const id = `deep-${String(index).padStart(3, '0')}`
      const parent = index ? `deep-${String(index - 1).padStart(3, '0')}` : 'default'
      sqlite
        .prepare(
          "INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES(?,'default',?,?,?,'now','now')",
        )
        .run(id, parent, id, id)
      sqlite
        .prepare(
          'INSERT INTO vc_site_ancestry SELECT ancestor_id,?,distance+1 FROM vc_site_ancestry WHERE descendant_id=? UNION ALL SELECT ?,?,0',
        )
        .run(id, parent, id, id)
    }
    sqlite.exec("INSERT INTO vc_site_policies VALUES('default','identity','read',1,1,1)")
    let queries = 0
    const counted = {
      prepare: (sql: string) => {
        queries++
        return db.prepare(sql)
      },
    } as unknown as D1Database
    expect(
      (await new OrganizationRepository(counted, 3).authority('deep-119', 'identity', 'read'))
        .reason,
    ).toBe('ancestor-oversight')
    expect(queries).toBeLessThanOrEqual(10)
  })
  it('narrows capabilities independently of roles and invalidates decisions immediately', async () => {
    const { sqlite, db } = fixture()
    const manager = new OrganizationRepository(db, 1),
      reader = new OrganizationRepository(db, 3)
    expect((await reader.authority('default', 'finances', 'read')).allowed).toBe(true)
    await manager.setRestrictions({
      site: 'default',
      user: 3,
      denied: [{ category: 'finances', operation: 'read' }],
      expectedRevision: 1,
      operationKey: 'restrict_finance_1234567',
    })
    expect((await reader.authority('default', 'finances', 'read')).allowed).toBe(false)
    expect((await reader.authority('default', 'identity', 'read')).allowed).toBe(true)
    await manager.setRestrictions({
      site: 'default',
      user: 3,
      denied: [],
      expectedRevision: 2,
      operationKey: 'restore_finance_1234567',
    })
    expect((await reader.authority('default', 'finances', 'read')).allowed).toBe(true)
    expect((await reader.authority('default', 'finances', 'export')).allowed).toBe(false)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(2)
    await expect(
      reader.setRestrictions({
        site: 'default',
        user: 3,
        denied: [],
        expectedRevision: 3,
        operationKey: 'self_elevate_1234567890',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
  })
  it('deactivates accounts without deleting history and prevents administrator lockout', async () => {
    const { sqlite, db } = fixture()
    const manager = new OrganizationRepository(db, 1),
      reader = new OrganizationRepository(db, 3)
    const mutation = {
      user: 3,
      disabled: true,
      expectedRevision: 0,
      reason: 'Fictional account offboarding',
      operationKey: 'account_deactivate_12345',
    }
    const first = await manager.setAccountStatus(mutation)
    expect(await manager.setAccountStatus(mutation)).toEqual(first)
    await expect(reader.authority('default', 'identity', 'read')).rejects.toBeInstanceOf(
      SiteAccessError,
    )
    expect(sqlite.prepare('SELECT count(*) AS n FROM users').get()?.n).toBe(3)
    await manager.setAccountStatus({
      ...mutation,
      disabled: false,
      expectedRevision: 1,
      operationKey: 'account_restore_12345678',
    })
    expect((await reader.authority('default', 'identity', 'read')).allowed).toBe(true)
    await expect(
      manager.setAccountStatus({ ...mutation, user: 1, operationKey: 'last_operator_123456789' }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect(await manager.isOperator()).toBe(true)
    await expect(
      reader.setAccountStatus({ ...mutation, user: 2, operationKey: 'reader_deactivate_123456' }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_platform_audit').get()?.n).toBe(2)
  })
  it('does not let identity administrators bypass financial restrictions or delegate them away', async () => {
    const { sqlite, db } = fixture()
    sqlite.exec("UPDATE vc_site_memberships SET role='administrator' WHERE user_id=2")
    const operator = new OrganizationRepository(db, 1),
      scoped = new OrganizationRepository(db, 2)
    await operator.setRestrictions({
      site: 'default',
      user: 2,
      denied: [{ category: 'finances', operation: 'read' }],
      expectedRevision: 1,
      operationKey: 'restricted_admin_1234567',
    })
    await expect(
      scoped.setRestrictions({
        site: 'default',
        user: 2,
        denied: [],
        expectedRevision: 2,
        operationKey: 'self_bypass_finance_1234',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    await expect(
      scoped.setMembership({
        site: 'default',
        user: 3,
        role: 'administrator',
        active: true,
        expectedRevision: 2,
        operationKey: 'delegate_bypass_1234567',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    expect(sqlite.prepare('SELECT revision FROM vc_sites').get()?.revision).toBe(2)
    expect(sqlite.prepare('SELECT role FROM vc_site_memberships WHERE user_id=3').get()?.role).toBe(
      'reader',
    )
  })
})
