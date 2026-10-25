import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { applyCRMTaskSchemaV1 } from '../../src/crm/task-schema-v1'
import { ContactTimeline } from '../../src/crm/timeline'
import { OrganizationRepository } from '../../src/organizations/repository'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
beforeEach(async () => {
  fixture = await crmTimelineFixture()
  fixture.sqlite.exec(`INSERT INTO users VALUES(3,'editor','Fictional other staff');
    INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES('default',3,'editor');
    UPDATE vc_site_memberships SET role='editor' WHERE site_id='default' AND user_id=2;
    CREATE TABLE review_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',personal INTEGER DEFAULT 1,document_type TEXT DEFAULT 'none',parent_id INTEGER REFERENCES review_tasks(id),creator_id INTEGER REFERENCES users(id),assignee_id INTEGER REFERENCES users(id),document_site TEXT,platform_mutation_proof TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE task_boards(id INTEGER PRIMARY KEY,platform_site TEXT);
    CREATE TABLE review_tasks_rels(parent_id INTEGER,path TEXT,task_boards_id INTEGER);
    CREATE TABLE vc_workspace_access(id TEXT PRIMARY KEY,board_id INTEGER,read_key TEXT);`)
  await applyCRMTaskSchemaV1(
    async (sql) => fixture.sqlite.exec(sql),
    async (table = 'review_tasks') =>
      fixture.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>,
    async () =>
      fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string
      }>,
  )
})
afterEach(() => fixture.close())
function task(title = 'Fictional private follow-up') {
  return fixture.sqlite
    .prepare(
      `INSERT INTO review_tasks(title,creator_id,assignee_id,document_site,crm_site,crm_type,crm_i_d,crm_operation_key,crm_intent_hash,crm_record_revision,crm_authority_revision,created_at,updated_at)
    VALUES(?,1,2,'default','default','contact',?,?,?,1,(SELECT authority_revision FROM vc_organizations WHERE id='default'),'2026-10-25T00:00:00.000Z','2026-10-25T00:00:00.000Z') RETURNING id`,
    )
    .get(title, fixture.contact, crypto.randomUUID(), 'a'.repeat(64))!.id as number
}
const events = (actor: number, before?: { date: string; id: string; revision: number }) =>
  new ContactTimeline(fixture.db, actor).list({
    site: 'default',
    contact: fixture.contact,
    group: 'tasks',
    before,
  })
it('paginates complete task history and hides private tasks from unrelated chapter staff', async () => {
  const completed = task()
  for (let i = 0; i < 60; i++) task(`Fictional paginated follow-up ${i}`)
  fixture.sqlite
    .prepare(
      "UPDATE review_tasks SET status='done',updated_at='2026-10-26T00:00:00.000Z' WHERE id=?",
    )
    .run(completed)
  const first = await events(2)
  expect(first.total).toBe(62)
  expect(first.docs).toHaveLength(50)
  expect(first.docs[0]).toMatchObject({
    title: 'Follow-up completed',
    label: 'Fictional private follow-up',
    targetType: 'task',
    targetID: String(completed),
  })
  const second = await events(2, first.next!)
  expect(second.docs).toHaveLength(12)
  expect(new Set([...first.docs, ...second.docs].map((row) => row.id)).size).toBe(62)
  expect((await events(3)).total).toBe(0)
  fixture.sqlite.prepare('UPDATE review_tasks SET assignee_id=NULL WHERE id=?').run(completed)
  expect((await events(2)).total).toBe(60)
})
it('requires the current board audience for boarded tasks even when the actor is the assignee', async () => {
  const id = task('Fictional board-restricted follow-up')
  fixture.sqlite.exec(
    "INSERT INTO task_boards VALUES(10,'default');INSERT INTO vc_workspace_access VALUES('board:10:3',10,'site:default:user:3')",
  )
  fixture.sqlite.prepare("INSERT INTO review_tasks_rels VALUES(?,'boards',10)").run(id)
  expect(
    (await new OrganizationRepository(fixture.db, 3).authority('default', 'workspace', 'read'))
      .allowed,
  ).toBe(true)
  expect(
    (await new OrganizationRepository(fixture.db, 3).authority('default', 'communications', 'read'))
      .allowed,
  ).toBe(true)
  expect((await events(2)).total).toBe(0)
  expect((await events(3)).docs[0].label).toBe('Fictional board-restricted follow-up')
  fixture.sqlite.exec("DELETE FROM vc_workspace_access WHERE id='board:10:3'")
  expect((await events(3)).total).toBe(0)
})
it('removes task titles when CRM or workspace permission is revoked', async () => {
  task()
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () =>
    Number(
      fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
    )
  expect((await events(2)).total).toBe(1)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'communications', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: crypto.randomUUID(),
  })
  expect((await events(2)).total).toBe(0)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'workspace', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: crypto.randomUUID(),
  })
  const page = await events(2)
  expect(page.total).toBe(0)
  expect(page.groups).not.toContain('tasks')
})
