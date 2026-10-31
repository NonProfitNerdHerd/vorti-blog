import { afterEach, beforeEach, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { applyCRMTaskSchemaV1 } from '../../src/crm/task-schema-v1'
import { crmTaskWhere } from '../../src/crm/task-where'
import { withAuthority, type AuthorityClaim } from '../../src/organizations/claims'
import { validateCRMTaskChange, crmTaskWrite } from '../../src/crm/task-access'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
async function upgrade() {
  await applyCRMTaskSchemaV1(
    async (sql) => fixture.sqlite.exec(sql),
    async (table = 'review_tasks') =>
      fixture.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>,
    async () =>
      fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string
      }>,
  )
}
beforeEach(async () => {
  fixture = await crmTimelineFixture()
  fixture.sqlite
    .exec(`CREATE TABLE review_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',parent_id INTEGER REFERENCES review_tasks(id),creator_id INTEGER REFERENCES users(id),assignee_id INTEGER REFERENCES users(id),document_site TEXT,platform_mutation_proof TEXT,created_at TEXT NOT NULL DEFAULT '2026-10-25T00:00:00Z',updated_at TEXT NOT NULL DEFAULT '2026-10-25T00:00:00Z');
    INSERT INTO review_tasks(id,title,status,creator_id) VALUES(41,'Fictional existing personal task','open',1);
    CREATE TABLE review_comments(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES review_tasks(id),body TEXT);
    CREATE TABLE task_attachments(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES review_tasks(id),filename TEXT);`)
  await upgrade()
})
afterEach(() => fixture.close())
it('rejects a conflicting physical access table without deleting its records', async () => {
  fixture.sqlite.exec(`DROP VIEW vc_crm_task_constituents;
    DROP VIEW vc_crm_task_contexts;
    CREATE TABLE vc_crm_task_contexts(id TEXT PRIMARY KEY);
    INSERT INTO vc_crm_task_contexts VALUES('retained-unexpected-record');`)
  await expect(upgrade()).rejects.toThrow('requires database views')
  expect(fixture.sqlite.prepare('SELECT id FROM vc_crm_task_contexts').all()).toEqual([
    { id: 'retained-unexpected-record' },
  ])
})
it('hides household membership tasks when their separate billing contact loses chapter access', () => {
  fixture.sqlite.exec(`
    INSERT INTO vc_crm_households(id,site_id,name,created_at,updated_at)
      VALUES('task-household','default','Fictional family','2026-10-25','2026-10-25');
    INSERT INTO vc_crm_membership_types(id,site_id,name,eligibility,term_months,dues_minor,currency,exponent)
      VALUES('task-membership-type','default','Fictional household membership','household',12,'0','USD',2);
  `)
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_membership_terms(
    id,site_id,type_id,household_id,billing_contact_id,type_name,starts_on,ends_on,
    dues_minor,currency,exponent,created_by,created_at)
    VALUES('task-membership','default','task-membership-type','task-household',?,
      'Fictional household membership','2026-10-25','2027-10-24','0','USD',2,1,'2026-10-25')`,
    )
    .run(fixture.contact)
  const task = insert({ type: 'membership', id: 'task-membership' })
  expect(fixture.sqlite.prepare('SELECT task_id FROM vc_crm_task_contexts').all()).toEqual([
    { task_id: task },
  ])
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(fixture.contact)
  expect(fixture.sqlite.prepare('SELECT task_id FROM vc_crm_task_contexts').all()).toEqual([])
  expect(() =>
    fixture.sqlite.prepare("UPDATE review_tasks SET status='done' WHERE id=?").run(task),
  ).toThrow('context')
})
function insert(
  link: Partial<{
    site: string
    type: string
    id: string
    parent: number
    operation: string
    hash: string | null
  }> = {},
) {
  return fixture.sqlite
    .prepare(
      `INSERT INTO review_tasks(title,creator_id,document_site,crm_site,crm_type,crm_i_d,parent_id,crm_operation_key,crm_intent_hash,crm_record_revision,crm_authority_revision) VALUES('Fictional linked follow-up',1,?,?,?,?,?,?,?,1,(SELECT authority_revision FROM vc_organizations WHERE id='default')) RETURNING id`,
    )
    .get(
      link.site ?? 'default',
      link.site ?? 'default',
      link.type ?? 'contact',
      link.id ?? fixture.contact,
      link.parent ?? null,
      link.operation ?? key(),
      link.hash === undefined ? 'a'.repeat(64) : link.hash,
    )!.id as number
}
it('upgrades additively, retains existing task audiences and records completion/reopening exactly once', async () => {
  await upgrade()
  expect(
    fixture.sqlite.prepare('SELECT title,creator_id,crm_type FROM review_tasks WHERE id=41').get(),
  ).toEqual({ title: 'Fictional existing personal task', creator_id: 1, crm_type: null })
  const task = insert()
  expect(
    fixture.sqlite.prepare('SELECT task_id,site,category FROM vc_crm_task_contexts').all(),
  ).toEqual([{ task_id: task, site: 'default', category: 'communications' }])
  fixture.sqlite.prepare("UPDATE review_tasks SET status='done' WHERE id=?").run(task)
  fixture.sqlite.prepare("UPDATE review_tasks SET status='done' WHERE id=?").run(task)
  fixture.sqlite.prepare("UPDATE review_tasks SET status='open' WHERE id=?").run(task)
  expect(
    fixture.sqlite
      .prepare('SELECT kind FROM vc_crm_task_events WHERE task_id=? ORDER BY rowid')
      .all(task)
      .map((row) => row.kind),
  ).toEqual(['created', 'completed', 'reopened'])
  expect(() =>
    fixture.sqlite.prepare('DELETE FROM vc_crm_task_events WHERE task_id=?').run(task),
  ).toThrow('history is retained')
  expect(() => insert({ hash: null })).toThrow('context')
})
it('requires explicit retained references and inherited subtask context and rejects duplicate retry keys', () => {
  const operation = key(),
    parent = insert({ operation })
  expect(() => insert({ operation })).toThrow('UNIQUE')
  expect(() => insert({ type: 'gift', id: fixture.contact })).toThrow('context')
  expect(() => insert({ site: 'other-chapter' })).toThrow('context')
  expect(() =>
    fixture.sqlite
      .prepare(
        'UPDATE review_tasks SET crm_type=NULL,crm_i_d=NULL,crm_site=NULL,crm_operation_key=NULL,crm_intent_hash=NULL WHERE id=?',
      )
      .run(parent),
  ).toThrow()
  expect(() =>
    fixture.sqlite
      .prepare("INSERT INTO review_tasks(title,parent_id) VALUES('Fictional forged child',?)")
      .run(parent),
  ).toThrow('context')
  expect(insert({ parent })).toBeGreaterThan(parent)
  expect(() => insert({ parent: 41 })).toThrow('context')
})
it('revokes native task context and dependent writes after affiliation removal without changing task revisions', () => {
  const task = insert()
  fixture.sqlite
    .prepare("INSERT INTO review_comments(task_id,body) VALUES(?,'Fictional permitted comment')")
    .run(task)
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(fixture.contact)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_task_contexts').get()!.n).toBe(0)
  expect(() =>
    fixture.sqlite
      .prepare("INSERT INTO review_comments(task_id,body) VALUES(?,'Fictional denied comment')")
      .run(task),
  ).toThrow('no longer available')
  expect(() =>
    fixture.sqlite
      .prepare(
        "INSERT INTO task_attachments(task_id,filename) VALUES(?,'Fictional denied file.txt')",
      )
      .run(task),
  ).toThrow('no longer available')
  expect(() =>
    fixture.sqlite.prepare("UPDATE review_tasks SET status='done' WHERE id=?").run(task),
  ).toThrow('context')
  fixture.sqlite
    .prepare("INSERT INTO review_comments(task_id,body) VALUES(41,'Fictional ordinary comment')")
    .run()
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM review_comments').get()!.n).toBe(2)
})
it('intersects native audiences with current CRM capabilities even for operators and nested comment/count predicates', () => {
  const claim: AuthorityClaim = {
    actor: 1,
    site: 'default',
    organization: 'default',
    epoch: 1,
    operator: true,
    bootstrap: false,
    allowed: { workspace: ['read', 'edit'], identity: ['read'], communications: ['read'] },
  }
  const req = {
    user: withAuthority({ id: 1 }, claim),
    payload: { config: { collections: [{ slug: 'crm-task-contexts' }] } },
  } as unknown as PayloadRequest
  expect(crmTaskWhere(req, 'read', 'task.', true)).toEqual({
    and: [
      {
        or: [
          { 'task.crmType': { exists: false } },
          {
            and: [
              { 'task.crmContext.site': { equals: 'default' } },
              { 'task.crmContext.category': { in: ['communications'] } },
              { 'task.crmContext.financial': { equals: 0 } },
              { 'task.crmContext.membership': { equals: 0 } },
              { 'task.crmContext.restricted': { equals: 0 } },
              { or: [
                { 'task.crmContext.owner': { exists: false } },
                { 'task.crmContext.owner': { equals: 1 } },
              ] },
            ],
          },
        ],
      },
    ],
  })
  expect(JSON.stringify(crmTaskWhere(req, 'edit', '', true))).not.toContain('crmContext.site')
  expect(crmTaskWhere(req, 'read', '', false)).toBe(false)
  const ordinary = {
      ...req,
      payload: { config: { collections: [] } },
    } as unknown as PayloadRequest,
    native = { creator: { equals: 1 } }
  expect(crmTaskWhere(ordinary, 'read', '', native)).toBe(native)
})
it('rejects forged creation and immutable-link changes and requires an assignee with current CRM and workspace edit access', async () => {
  const req = {
      user: { id: 1 },
      context: {},
      payload: { db: { client: fixture.db } },
    } as unknown as PayloadRequest,
    data = {
      crmSite: 'default',
      crmType: 'contact',
      crmID: fixture.contact,
      crmOperationKey: key(),
      crmIntentHash: 'a'.repeat(64),
      crmRecordRevision: 1,
      crmAuthorityRevision: 0,
      title: 'Fictional call follow-up',
      assignee: 2,
    }
  await expect(validateCRMTaskChange(req, { ...data }, undefined, 'create')).rejects.toThrow(
    'from their CRM record',
  )
  const authority = new OrganizationRepository(fixture.db, 1),
    revision = () =>
      Number(
        fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
      )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: true,
    expectedRevision: revision(),
    operationKey: key(),
  })
  req.context = { [crmTaskWrite]: true }
  data.crmAuthorityRevision = Number(
    fixture.sqlite
      .prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'")
      .get()!.authority_revision,
  )
  expect((await validateCRMTaskChange(req, { ...data }, undefined, 'create')).documentSite).toBe(
    'default',
  )
  await expect(validateCRMTaskChange(req, { crmID: 'other' }, data, 'update')).rejects.toThrow(
    'cannot be changed',
  )
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'communications', operation: 'edit' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  await expect(validateCRMTaskChange(req, { ...data }, undefined, 'create')).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM review_tasks').get()!.n).toBe(1)
})
