import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultOrganizationSeed, organizationSchema } from '../../src/organizations/schema'
import { atomicSiteMutation, SiteConflictError } from '../../src/organizations/atomic'
import { OrganizationRepository, SiteAccessError } from '../../src/organizations/repository'
import { informationCategories, siteOperations } from '../../src/organizations/policy'
import { legacyContentCapabilities } from '../../src/organizations/schema-v3'
import { identityAuthority, claimRequest } from '../../src/organizations/identity-authority'
import { authorityClaim } from '../../src/organizations/claims'
import { cmsSiteContext, cmsScope } from '../../src/organizations/cms-scope'
import { createLocalReq, type PayloadRequest } from 'payload'
import { bindEditorSite } from '../../src/organizations/editor-site'
import { mutationFence, guardedMutations, nativeMutationSchemaV1, nativeMutationGuardsV1, tenantMutationGuards } from '../../src/organizations/mutation-guards'
import { organizationAdministration } from '../../src/organizations/admin-plugin'
import { tenantAuthority } from '../../src/organizations/authority-plugin'
import type { WorkspaceProof } from '../../src/organizations/workspace-proof'
import { rejectMutationProofQuery } from '../../src/organizations/mutation-query'
import { guardedGlobals, globalSettingsGuards } from '../../src/organizations/site-settings'
import { tenantGlobals } from '../../src/organizations/globals-plugin'
import { CMS_MENU_RENDER } from '../../src/organizations/cms-scope'
import { nativeUserAuthenticationGuardsV2 } from '../../src/organizations/mutation-guards'
import type { Config, SanitizedCollectionConfig } from 'payload'

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
  sqlite.exec("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'")
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
  it('permits native authentication maintenance with a stale stored proof without permitting account changes', () => {
    const { sqlite } = fixture()
    sqlite.exec('ALTER TABLE users ADD COLUMN platform_mutation_proof TEXT; ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN hash TEXT; ALTER TABLE users ADD COLUMN future_private_setting TEXT')
    for (const table of ['task_boards', 'task_projects', 'review_tasks']) sqlite.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY,updated_at TEXT,membership_revision INTEGER)`)
    const columns = sqlite.prepare('PRAGMA table_info(users)').all().map(row => String(row.name))
    for (const statement of nativeUserAuthenticationGuardsV2(columns)) sqlite.exec(statement)
    const epoch = Number(sqlite.prepare("SELECT authority_revision AS n FROM vc_organizations WHERE id='default'").get()?.n)
    const proof = JSON.stringify({ actor: 1, site: 'default', epoch })
    sqlite.prepare('UPDATE users SET platform_mutation_proof=? WHERE id=1').run(proof)
    sqlite.exec("UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id='default'")
    sqlite.prepare("INSERT INTO users(id,role,platform_mutation_proof,login_attempts,hash) VALUES(1,'administrator',?,1,'native-reset-hash') ON CONFLICT(id) DO UPDATE SET role=excluded.role,platform_mutation_proof=excluded.platform_mutation_proof,login_attempts=excluded.login_attempts,hash=excluded.hash").run(proof)
    expect(sqlite.prepare('SELECT login_attempts FROM users WHERE id=1').get()?.login_attempts).toBe(1)
    expect(() => sqlite.prepare("UPDATE users SET role='editor',platform_mutation_proof=? WHERE id=1").run(proof)).toThrow('Mutation authority changed')
    expect(() => sqlite.prepare("UPDATE users SET future_private_setting='changed',platform_mutation_proof=? WHERE id=1").run(proof)).toThrow('Mutation authority changed')
    expect(() => sqlite.prepare("UPDATE users SET platform_mutation_proof=? WHERE id=1").run(JSON.stringify({ actor: 1, site: 'default', epoch, nonce: 'new-stale-request' }))).toThrow('Mutation authority changed')
    expect(() => sqlite.prepare("INSERT INTO users(id,role,platform_mutation_proof) VALUES(9,'administrator',?)").run(proof)).toThrow('Mutation authority changed')
  })
  it('allows only server-selected compatibility navigation and fences its final delivery', async () => {
    const { sqlite, db } = fixture()
    const config = tenantGlobals({ globals: [{ slug: 'navigation', fields: [] }] } as Config)
    const global = config.globals![0]
    const req = { user: null, context: { ...cmsSiteContext('default'), [CMS_MENU_RENDER]: true }, headers: new Headers(), payload: { db: { client: db } } } as unknown as PayloadRequest
    const read = global.access!.read!
    if (typeof read !== 'function') throw Error('Expected guarded navigation access')
    await expect(read({ req: { ...req, context: { menuOperation: 'public-render' } } })).resolves.toBe(false)
    await expect(read({ req })).resolves.toBe(true)
    const afterRead = global.hooks!.afterRead!.at(-1)!
    const args = { req, doc: { platformGlobalProof: { actor: 1 }, primary: [] } } as Parameters<typeof afterRead>[0]
    expect(await afterRead(args)).not.toHaveProperty('platformGlobalProof')
    sqlite.exec("UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id='default'")
    await expect(afterRead(args)).rejects.toThrow('Site permissions changed')
  })
  it('fences global settings inserts and updates against revocation and operator loss', () => {
    const { sqlite } = fixture()
    for (const table of guardedGlobals) sqlite.exec(`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY,value TEXT,platform_global_proof TEXT)`)
    for (const statement of globalSettingsGuards) sqlite.exec(statement)
    const epoch = Number(sqlite.prepare("SELECT authority_revision AS n FROM vc_organizations WHERE id='default'").get()?.n)
    const proof = JSON.stringify({ actor: 1, epoch, nonce: 'server-generated' })
    for (const table of guardedGlobals) sqlite.prepare(`INSERT INTO "${table}" VALUES(1,'original',?)`).run(proof)
    sqlite.exec("UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id='default'")
    for (const table of guardedGlobals) {
      expect(() => sqlite.prepare(`UPDATE "${table}" SET value='stale',platform_global_proof=? WHERE id=1`).run(proof)).toThrow('Global authority changed')
      expect(() => sqlite.prepare(`INSERT INTO "${table}" VALUES(2,'stale',?)`).run(proof)).toThrow('Global authority changed')
      expect(sqlite.prepare(`SELECT value FROM "${table}" WHERE id=1`).get()?.value).toBe('original')
    }
    const currentProof = JSON.stringify({ actor: 2, epoch: epoch + 1, nonce: 'server-generated' })
    expect(() => sqlite.prepare('UPDATE system_settings SET platform_global_proof=? WHERE id=1').run(currentProof)).toThrow('Global authority changed')
  })
  it('isolates site identity settings, audits retries, and rejects stale or revoked writes', async () => {
    const { db, sqlite } = fixture()
    const repo = new OrganizationRepository(db, 1)
    const site = String((await repo.createOrganization({ name: 'Fictional settings', siteName: 'National', operationKey: crypto.randomUUID() })).site)
    const other = String((await repo.createOrganization({ name: 'Unrelated settings', siteName: 'Unrelated', operationKey: crypto.randomUUID() })).site)
    const input = { site, expectedRevision: 0, operationKey: crypto.randomUUID(), settings: { siteName: 'National office', siteTagline: 'Fictional', timezone: 'America/Chicago' } }
    await expect(repo.setSettings(input)).resolves.toMatchObject({ revision: 1 })
    await expect(repo.setSettings(input)).resolves.toMatchObject({ revision: 1 })
    expect((await repo.settings(site)).settings).toEqual(input.settings)
    expect((await repo.settings(other)).settings.siteName).toBe('Unrelated')
    await expect(new OrganizationRepository(db, 3).settings(site)).rejects.toBeInstanceOf(SiteAccessError)
    await expect(repo.setSettings({ ...input, operationKey: crypto.randomUUID() })).rejects.toBeInstanceOf(SiteConflictError)
    await expect(repo.setSettings({ ...input, site: 'default' })).rejects.toThrow('compatibility')
    await expect(repo.setSettings({ ...input, settings: { ...input.settings, timezone: 'Invalid/Zone' } })).rejects.toThrow('IANA timezone')
    expect(sqlite.prepare("SELECT count(*) AS n FROM vc_platform_audit WHERE action='site.settings-changed'").get()?.n).toBe(1)
    const original = db.batch.bind(db)
    db.batch = (async (statements: D1PreparedStatement[]) => {
      sqlite.prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=?)').run(site)
      return original(statements)
    }) as typeof db.batch
    await expect(repo.setSettings({ ...input, expectedRevision: 1, operationKey: crypto.randomUUID() })).rejects.toBeInstanceOf(SiteConflictError)
    expect(sqlite.prepare('SELECT revision FROM vc_site_settings WHERE site_id=?').get(site)?.revision).toBe(1)
  })
  it('blocks proof inference through native counts, relation filters, sort and join selections', () => {
    for (const args of [
      { where: { and: [{ 'task.platformMutationProof.audiences.boards.0.id': { equals: 9 } }] } },
      { sort: '-version.platformMutationProof.actor' },
      { field: 'platformMutationProof.audiences.boards.0.id' },
      { joins: { task: { where: { platformMutationProof: { exists: true } } } } },
      { select: { task: { platformMutationProof: true } } },
    ]) expect(() => rejectMutationProofQuery(args)).toThrow('not a queryable record field')
    expect(() => rejectMutationProofQuery({ where: { title: { contains: 'platformMutationProof' } }, select: { platformMutationProof: false } })).not.toThrow()
  })
  it('paginates authorized sites without exposing denied candidate IDs or accepting another account’s cursor', async () => {
    const { sqlite, db } = fixture()
    for (let index = 0; index < 52; index++) {
      const id = `hidden-${String(index).padStart(3, '0')}`
      sqlite.prepare("INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES(?,'default','default','Hidden',?,'now','now')").run(id, id)
      sqlite.prepare("INSERT INTO vc_site_ancestry VALUES(?,?,0),('default',?,1)").run(id, id, id)
    }
    const reader = new OrganizationRepository(db, 3)
    const first = await reader.listSites()
    expect(first.sites.map(site => site.id)).toEqual(['default'])
    expect(first.next).toBeTruthy()
    expect(first.next).not.toContain('hidden-')
    expect((await reader.listSites(first.next!)).sites).toEqual([])
    await expect(new OrganizationRepository(db, 2).listSites(first.next!)).rejects.toThrow('valid site page')
  })
  it('keeps administration local, authenticated and same-origin, and acknowledges audited policy changes', async () => {
    const { db } = fixture()
    const base = { collections: [], endpoints: [] } as Config
    expect(organizationAdministration({ enabled: false })(base)).toBe(base)
    const config = tenantAuthority(organizationAdministration({ enabled: true })(base))
    const invoke = async (user: number | null, method: 'get' | 'post', body?: object, origin = 'https://local.invalid', query = '') => {
      const http = new Request('https://local.invalid/api/organization-admin' + query, { method: method.toUpperCase(),
        headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return config.endpoints!.find(endpoint => endpoint.path === '/organization-admin' && endpoint.method === method)!.handler({
        context: {}, headers: http.headers, url: http.url, body: http.body,
        user: user ? { id: user, role: user === 1 ? 'administrator' : 'editor', collection: 'users' } : null,
        payload: { db: { client: db } },
      } as unknown as PayloadRequest)
    }
    expect((await invoke(null, 'get')).status).toBe(401)
    expect((await invoke(3, 'get', undefined, 'https://local.invalid', '?site=default')).status).toBe(403)
    const change = { action: 'policy', site: 'default', category: 'identity', operation: 'read', descendantsAllowed: true, overseeDescendants: false,
      expectedRevision: 1, operationKey: crypto.randomUUID(), actor: 3, operator: true }
    expect((await invoke(1, 'post', change, 'https://foreign.invalid')).status).toBe(403)
    expect((await invoke(1, 'post', change)).status).toBe(200)
    expect((await invoke(1, 'post', { ...change, expectedRevision: 1, operationKey: crypto.randomUUID() })).status).toBe(409)
    expect((await invoke(3, 'post', { ...change, expectedRevision: 2, operationKey: crypto.randomUUID() })).status).toBe(403)
  })
  it('pins a request epoch through nested calls and fences a revoked raw mutation with its audit', async () => {
    const { sqlite, db } = fixture()
    const req = { context: {}, headers: new Headers(), payload: { db: { client: db } }, user: { id: 2, role: 'designer' } } as unknown as PayloadRequest
    await claimRequest(req)
    const fence = await mutationFence(req)
    sqlite.exec('UPDATE vc_site_memberships SET active=0 WHERE user_id=2')
    await expect(claimRequest(req)).rejects.toThrow('permissions changed')
    await expect(db.batch([...fence, db.prepare("UPDATE legacy_posts SET title='Forbidden' WHERE id=7")])).rejects.toThrow()
    expect(sqlite.prepare('SELECT title FROM legacy_posts WHERE id=7').get()?.title).toBe('Retain historical content')
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_write_guards').get()?.n).toBe(0)
  })
  it('rejects stale native and autosave proofs while allowing independent trusted payment updates', async () => {
    const { sqlite, db } = fixture()
    for (const sql of nativeMutationSchemaV1) sqlite.exec(sql)
    for (const [, table, versions] of guardedMutations) {
      if (table === 'users') sqlite.exec('ALTER TABLE users ADD COLUMN platform_mutation_proof TEXT')
      else sqlite.exec(`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY,platform_mutation_proof TEXT,value TEXT,updated_at TEXT,membership_revision INTEGER DEFAULT 0,project_id INTEGER)`)
      if (versions) sqlite.exec(`CREATE TABLE "${versions}"(id INTEGER PRIMARY KEY,version_platform_mutation_proof TEXT)`)
    }
    for (const sql of nativeMutationGuardsV1) sqlite.exec(sql)
    const epoch = sqlite.prepare('SELECT authority_revision AS n FROM vc_organizations').get()?.n
    const proof = JSON.stringify({ actor: 2, site: 'default', epoch })
    sqlite.exec("INSERT INTO task_boards(id,updated_at,membership_revision) VALUES(9,'before',0); INSERT INTO review_tasks(id,updated_at,value) VALUES(9,'before','Original task')")
    const audiences: WorkspaceProof = { boards: [{ id: 9, updated: 'before', revision: 0 }], projects: [], tasks: [{ id: 9, updated: 'before' }] }
    const taskProof = JSON.stringify({ actor: 2, site: 'default', epoch, audiences })
    const req = { context: {}, headers: new Headers(), payload: { db: { client: db } }, user: { id: 2, role: 'designer' } } as unknown as PayloadRequest
    const fence = await mutationFence(req, audiences)
    sqlite.exec('UPDATE task_boards SET membership_revision=membership_revision+1 WHERE id=9')
    expect(() => sqlite.prepare("UPDATE review_tasks SET value='Forbidden',platform_mutation_proof=? WHERE id=9").run(taskProof)).toThrow('authority changed')
    await expect(db.batch([...fence, db.prepare("UPDATE legacy_posts SET title='Forbidden' WHERE id=7")])).rejects.toThrow()
    expect(sqlite.prepare('SELECT title FROM legacy_posts WHERE id=7').get()?.title).toBe('Retain historical content')
    const guarded = tenantMutationGuards({ collections: [{ slug: 'task-views', fields: [], hooks: { beforeValidate: [({ data }) => {
      sqlite.exec('UPDATE task_boards SET membership_revision=membership_revision+1 WHERE id=9')
      return data
    }] } }] } as Config).collections![0]
    let args: Parameters<NonNullable<typeof guarded.hooks.beforeChange>[number]>[0] = {
      req, data: { board: 9 }, operation: 'create', context: req.context, collection: guarded as SanitizedCollectionConfig,
    }
    for (const hook of guarded.hooks!.beforeValidate!) {
      const result = await hook(args)
      if (result) args = { ...args, data: result }
    }
    await expect(guarded.hooks!.beforeChange!.at(-1)!(args)).rejects.toThrow('Workspace changed')
    const privileged = await guarded.hooks!.afterRead!.at(-1)!({
      collection: guarded as SanitizedCollectionConfig, req, context: req.context, overrideAccess: true,
      doc: { id: 9, platformMutationProof: { audiences } },
    })
    expect(privileged).not.toHaveProperty('platformMutationProof')
    sqlite.prepare('INSERT INTO form_submissions(id,platform_mutation_proof,value) VALUES(1,?,?)').run(proof, 'Original')
    sqlite.exec('UPDATE vc_site_memberships SET active=0 WHERE user_id=2')
    expect(() => sqlite.prepare('UPDATE form_submissions SET value=?,platform_mutation_proof=? WHERE id=1').run('Forbidden', proof)).toThrow('authority changed')
    expect(() => sqlite.prepare('INSERT INTO _forms_v(id,version_platform_mutation_proof) VALUES(1,?)').run(proof)).toThrow('authority changed')
    sqlite.prepare("INSERT INTO vc_native_delete_proofs(collection,record_id,organization_id,actor_id,authority_revision,created_at) VALUES('form-submissions','1','default',2,?,?)").run(epoch!, new Date().toISOString())
    expect(() => sqlite.exec('DELETE FROM form_submissions WHERE id=1')).toThrow('authority changed')
    // Provider-verified reconciliation is an independent system operation, not a staff save.
    sqlite.exec("UPDATE form_submissions SET value='Provider reconciliation' WHERE id=1")
    expect(sqlite.prepare('SELECT value FROM form_submissions WHERE id=1').get()?.value).toBe('Provider reconciliation')
  })
  it('keeps old native editors bound to their original site after another tab switches context', async () => {
    const { db } = fixture(), repo = new OrganizationRepository(db, 1)
    const root = await repo.createOrganization({ name: 'Fictional tab network', siteName: 'National', operationKey: 'native_tabs_network_12345' })
    await repo.setContext({ site: String(root.site), expectedRevision: 0, operationKey: 'native_tabs_context_12345' })
    const req = { context: {}, headers: new Headers(), payload: { db: { client: db } }, user: { id: 1, role: 'administrator' } } as unknown as PayloadRequest
    await claimRequest(req)
    expect(authorityClaim(req.user)?.site).toBe(root.site)
    await bindEditorSite(req, 'default')
    expect(authorityClaim(req.user)?.site).toBe('default')
    // Payload clones contexts using Object.keys, so server-only symbol context
    // must retain its site and authority witness through the real local API.
    const payload = { ...req.payload, config: { admin: { user: 'users' } }, collections: {} } as PayloadRequest['payload']
    const nested = await createLocalReq({ req: { ...req, i18n: { t: () => '' } } as unknown as PayloadRequest }, payload)
    expect((await cmsScope(nested, 'read')).site).toBe('default')
    const conflicting = { ...req, context: {}, headers: new Headers({ 'x-vorticause-site': String(root.site) }) } as PayloadRequest
    await expect(bindEditorSite(conflicting, 'default')).rejects.toThrow('editor site changed')
    const other = { ...req, context: {}, user: { id: 3, role: 'editor' } } as unknown as PayloadRequest
    await bindEditorSite(other, root.site)
    expect(authorityClaim(other.user)?.allowed.identity).toBeUndefined()
  })
  it('manages a hierarchy, shares only approved categories, and moves a subtree atomically', async () => {
    const { db, sqlite } = fixture(), repo = new OrganizationRepository(db, 1)
    const revision = (id: string) => Number(sqlite.prepare('SELECT revision FROM vc_sites WHERE id=?').get(id)?.revision)
    const child = async (parent: string, name: string) => { sqlite.prepare('UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id=?').run(parent); return String((await repo.createSite({ parent, name, expectedRevision: revision(parent), operationKey: crypto.randomUUID() })).site) }
    const national = String((await repo.createOrganization({ name: 'Fictional hierarchy', siteName: 'National', operationKey: crypto.randomUUID() })).site)
    const regionA = await child(national, 'Region A'), regionB = await child(national, 'Region B'), local = await child(regionA, 'Local'), branch = await child(local, 'Branch')
    await repo.setMembership({ site: regionB, user: 2, role: 'reader', active: true, expectedRevision: revision(regionB), operationKey: crypto.randomUUID() })
    const reader = new OrganizationRepository(db, 2)
    expect((await reader.authority(local, 'identity', 'read')).allowed).toBe(false)
    await repo.setSharing({ site: local, receiver: regionB, category: 'identity', operation: 'read', receiverDescendants: false, revoked: false, expectedRevision: revision(local), operationKey: crypto.randomUUID() })
    expect((await reader.authority(local, 'identity', 'read')).reason).toBe('explicit-sharing')
    expect((await reader.authority(local, 'finances', 'read')).allowed).toBe(false)
    expect((await reader.authority(local, 'identity', 'configure')).allowed).toBe(false)
    await repo.moveSite({ site: local, parent: regionB, expectedRevision: revision(local), expectedParentRevision: revision(regionB), operationKey: crypto.randomUUID() })
    expect(sqlite.prepare('SELECT distance FROM vc_site_ancestry WHERE ancestor_id=? AND descendant_id=?').get(regionB, branch)?.distance).toBe(2)
    expect(sqlite.prepare('SELECT 1 FROM vc_site_ancestry WHERE ancestor_id=? AND descendant_id=?').get(regionA, branch)).toBeUndefined()
    await expect(repo.moveSite({ site: local, parent: branch, expectedRevision: revision(local), expectedParentRevision: revision(branch), operationKey: crypto.randomUUID() })).rejects.toThrow('subtree')
    const before = sqlite.prepare('SELECT parent_id FROM vc_sites WHERE id=?').get(local)?.parent_id
    await expect(repo.moveSite({ site: local, parent: regionA, expectedRevision: revision(local), expectedParentRevision: 0, operationKey: crypto.randomUUID() })).rejects.toBeInstanceOf(SiteConflictError)
    expect(sqlite.prepare('SELECT parent_id FROM vc_sites WHERE id=?').get(local)?.parent_id).toBe(before)
    expect((await repo.administration(local)).decisions).toHaveLength(informationCategories.length * siteOperations.length)
  })
  it('prevents restricted administrators creating children to regain a denied category', async () => {
    const { db, sqlite } = fixture(), repo = new OrganizationRepository(db, 2)
    sqlite.exec("UPDATE vc_site_memberships SET role='administrator' WHERE user_id=2; INSERT INTO vc_member_restrictions VALUES('default',2,'finances','read')")
    await expect(repo.createSite({ parent: 'default', name: 'Escalation', expectedRevision: 1, operationKey: crypto.randomUUID() })).rejects.toBeInstanceOf(SiteAccessError)
    expect(sqlite.prepare('SELECT count(*) AS n FROM vc_sites').get()?.n).toBe(1)
  })
  it('keeps concurrent site claims on request copies instead of mutating a shared account', async () => {
    const { sqlite, db } = fixture()
    for (const sql of legacyContentCapabilities) sqlite.exec(sql)
    const root = await new OrganizationRepository(db, 1).createOrganization({ name: 'Fictional other network', siteName: 'Other', operationKey: 'request_context_other_12345' })
    const user = { id: 2, role: 'designer' }
    const request = (site: string) => ({ context: cmsSiteContext(site), payload: { db: { client: db } }, user }) as unknown as PayloadRequest
    const first = request('default'), second = request(String(root.site))
    await Promise.all([claimRequest(first), claimRequest(second)])
    expect(first.user).not.toBe(user); expect(second.user).not.toBe(user)
    expect(authorityClaim(user)).toBeNull()
    expect(Object.getOwnPropertySymbols(first.user!)).toHaveLength(0)
    expect(first.user!.platformAuthority).toEqual({ actor: user.id })
    expect(authorityClaim(JSON.parse(JSON.stringify(first.user)))).toBeNull()
    expect(authorityClaim({ ...first.user! })?.site).toBe('default')
    expect(authorityClaim(first.user)?.site).toBe('default')
    expect(authorityClaim(first.user)?.allowed.content).toContain('edit')
    expect(authorityClaim(second.user)?.site).toBe(root.site)
    expect(authorityClaim(second.user)?.allowed.content).toBeUndefined()
  })
  it('derives the same complete capability matrix as individual checks and fences cached revocations', async () => {
    const { sqlite, db } = fixture()
    for (const sql of legacyContentCapabilities) sqlite.exec(sql)
    const repository = new OrganizationRepository(db, 2)
    const matrix = await repository.authoritySet('default')
    for (const category of informationCategories) for (const operation of siteOperations) {
      expect(matrix.allowed[category]?.includes(operation) === true).toBe((await repository.authority('default', category, operation)).allowed)
    }
    expect(matrix.allowed.content).toContain('configure')
    expect(matrix.allowed['form-submissions']).not.toContain('read')
    const req = { context: cmsSiteContext('default'), payload: { db: { client: db } }, user: { id: 2, role: 'designer' } } as unknown as PayloadRequest
    const first = await identityAuthority(req, req.user)
    expect(first.allowed.content).toContain('edit')
    sqlite.exec("INSERT INTO vc_member_restrictions VALUES('default',2,'content','edit')")
    const second = await identityAuthority(req, req.user)
    expect(second.epoch).toBeGreaterThan(first.epoch)
    expect(second.allowed.content).not.toContain('edit')
    expect(Object.isFrozen(second.allowed)).toBe(true)
  })
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
    sqlite.prepare('UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id=?').run(root.site as string)
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
    ).toBe(11)
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
    ).toBe(8)
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
    await new OrganizationRepository(counted, 3).authority('deep-009', 'identity', 'read')
    const shallowQueries = queries
    queries = 0
    expect(
      (await new OrganizationRepository(counted, 3).authority('deep-119', 'identity', 'read'))
        .reason,
    ).toBe('ancestor-oversight')
    // Tenant-model detection adds a fixed compatibility check; hierarchy depth
    // may add joined pages, never one lookup per ancestor.
    expect(queries).toBeLessThanOrEqual(12)
    expect(queries - shallowQueries).toBeLessThanOrEqual(2)
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
