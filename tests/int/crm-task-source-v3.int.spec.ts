import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { applyCRMTaskSchemaV1 } from '../../src/crm/task-schema-v1'
import { crmTaskSchemaV3 } from '../../src/crm/task-context-v3'
import { fundraisingSchemaV2 } from '../../src/crm/fundraising-schema-v2'
import { correspondenceBatchSchemaV1 } from '../../src/crm/correspondence-batch-schema-v1'
import { importSchemaV1 } from '../../src/crm/import-schema-v1'

it('retains native tasks while adding fund and operational source checks', async () => {
  const fixture = await crmTimelineFixture()
  try {
    for (const statement of [...fundraisingSchemaV2, ...correspondenceBatchSchemaV1, ...importSchemaV1]) fixture.sqlite.exec(statement)
    fixture.sqlite.exec(`CREATE TABLE review_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',parent_id INTEGER REFERENCES review_tasks(id),creator_id INTEGER REFERENCES users(id),assignee_id INTEGER REFERENCES users(id),document_site TEXT,platform_mutation_proof TEXT,created_at TEXT NOT NULL DEFAULT '2026-10-31T00:00:00Z',updated_at TEXT NOT NULL DEFAULT '2026-10-31T00:00:00Z');
      INSERT INTO review_tasks(id,title,creator_id) VALUES(10,'Existing unlinked task',1);
      CREATE TABLE review_comments(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES review_tasks(id),body TEXT);
      CREATE TABLE task_attachments(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES review_tasks(id),filename TEXT);`)
    await applyCRMTaskSchemaV1(
      async statement => fixture.sqlite.exec(statement),
      async (table = 'review_tasks') => fixture.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>,
      async () => fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>,
    )
    for (const statement of crmTaskSchemaV3) fixture.sqlite.exec(statement)
    fixture.sqlite.exec(`INSERT INTO vc_crm_funds(id,site_id,name,created_at,updated_at) VALUES('fund-task','default','Fictional fund','2026-10-31','2026-10-31')`)
    const epoch = Number((fixture.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get() as { authority_revision: number }).authority_revision)
    fixture.sqlite.prepare(`INSERT INTO review_tasks(title,creator_id,document_site,crm_site,crm_type,crm_i_d,crm_operation_key,crm_intent_hash,crm_record_revision,crm_authority_revision) VALUES('Fund follow-up',1,'default','default','fund','fund-task',?,?,1,?)`)
      .run(crypto.randomUUID(), 'a'.repeat(64), epoch)
    expect(fixture.sqlite.prepare('SELECT id,title FROM review_tasks WHERE id=10').get()).toEqual({ id: 10, title: 'Existing unlinked task' })
    expect(fixture.sqlite.prepare("SELECT category FROM vc_crm_task_contexts WHERE task_id<>10").get()).toEqual({ category: 'finances' })
    expect(() => fixture.sqlite.prepare("INSERT INTO review_tasks(title,creator_id,document_site,crm_site,crm_type,crm_i_d,crm_operation_key,crm_intent_hash,crm_record_revision,crm_authority_revision) VALUES('Bad fund',1,'default','default','fund','missing',?,?,1,?)").run(crypto.randomUUID(), 'b'.repeat(64), epoch)).toThrow()
  } finally { fixture.close() }
})
