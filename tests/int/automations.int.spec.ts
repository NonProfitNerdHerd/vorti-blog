import { afterEach, describe, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { workflowTemplates } from '@/automations/templates'
import {
  automationSchema,
  sourceTriggers,
  nativeAutomationSources,
  contactAutomationTrigger,
} from '@/automations/schema'
import { AutomationStore } from '@/automations/store'
import { AutomationRunner, type AutomationAdapter } from '@/automations/runtime'
import { mask, resolve, validateDefinition, type Definition, type Step } from '@/automations/model'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
function fixture() {
  const local = localD1()
  cleanups.push(local.close)
  for (const statement of automationSchema) local.sqlite.exec(statement)
  const store = new AutomationStore(local.db)
  const writes: Step[] = [],
    records = new Map<string, Record<string, unknown>>([
      ['1', { id: '1', title: 'Original', status: 'open' }],
    ])
  let allowed = true,
    fieldAllowed = true
  const adapter: AutomationAdapter = {
    authorize: async () => {
      if (!allowed) throw Object.assign(Error('Denied'), { status: 403 })
    },
    read: async (_site, _owner, ref) => {
      if (!allowed || !records.has(ref.id)) throw Object.assign(Error('Denied'), { status: 403 })
      const doc = { ...records.get(ref.id) }
      if (!fieldAllowed) delete doc.title
      return doc
    },
    execute: async (site, owner, step) => {
      await adapter.authorize(site, owner)
      if (step.kind === 'find')
        return {
          output: await adapter.read(site, owner, {
            resource: step.resource!,
            id: String(step.recordID),
          }),
          reference: { resource: step.resource!, id: String(step.recordID) },
        }
      writes.push(step)
      const id = String(step.recordID || writes.length + 1),
        doc = { id, ...records.get(id), ...step.data }
      records.set(id, doc)
      return { output: doc, reference: { resource: step.resource!, id } }
    },
  }
  const runner = new AutomationRunner(store, adapter)
  const definition: Definition = {
    trigger: { kind: 'manual' },
    steps: [
      { id: 'find', name: 'Find source', kind: 'find', resource: 'review-tasks', recordID: '1' },
      {
        id: 'check',
        name: 'Check status',
        kind: 'condition',
        left: { $ref: 'steps.find.status' },
        operator: 'equals',
        right: 'open',
      },
      {
        id: 'write',
        name: 'Create follow-up',
        kind: 'create',
        resource: 'review-tasks',
        when: { step: 'check', equals: true },
        data: { title: { $ref: 'steps.find.title' } },
      },
      {
        id: 'other',
        name: 'Other branch',
        kind: 'update',
        resource: 'review-tasks',
        recordID: '1',
        when: { step: 'check', equals: false },
        data: { status: 'done' },
      },
    ],
  }
  const saved = async (value = definition) =>
    store.save('default', 1, { name: 'Follow up', definition: value })
  const start = async (value = definition) => {
    const row = await saved(value)
    const id = await store.enqueue(row, 'test', { id: crypto.randomUUID(), input: {} }, true)
    return { row, id }
  }
  return {
    ...local,
    store,
    runner,
    adapter,
    definition,
    writes,
    records,
    saved,
    start,
    revoke: () => {
      allowed = false
    },
    restrictField: () => {
      fieldAllowed = false
    },
  }
}

describe('shared automations', () => {
  it('offers only templates supported by the shared registry', () => {
    for (const template of workflowTemplates)
      expect(validateDefinition(template.definition)).toEqual(template.definition)
  })
  it('shares published templates within a site without granting ownership or history access', async () => {
    const f = fixture(),
      row = await f.saved()
    await expect(f.store.share(row, true)).rejects.toThrow('Publish')
    const published = await f.store.control(row, 'publish'),
      shared = await f.store.share(published, true)
    expect((await f.store.shared('default')).map((r) => r.id)).toEqual([row.id])
    expect(await f.store.shared('other')).toEqual([])
    expect((await f.store.sharedTemplate('default', row.id)).definition).toEqual(f.definition)
    await expect(f.store.sharedTemplate('other', row.id)).rejects.toThrow('unavailable')
    await expect(f.store.get('default', 2, row.id)).rejects.toThrow('unavailable')
    const copy = await f.store.save('default', 2, {
      name: 'My copy',
      definition: (await f.store.sharedTemplate('default', row.id)).definition,
    })
    expect(copy.owner).toBe(2)
    await f.store.share(shared, false)
    expect(await f.store.shared('default')).toEqual([])
    await expect(f.store.sharedTemplate('default', row.id)).rejects.toThrow('unavailable')
  })
  it('shows historical inputs and outputs only while every source field remains readable', async () => {
    const f = fixture(),
      { id } = await f.start()
    await f.runner.tick()
    const run = await f.store.run('default', 1, id)
    const readable = await f.runner.diagnostics(run)
    expect(readable.valuesVisible).toBe(true)
    expect(readable.steps[2].inputs).toMatchObject({ data: { title: 'Original' } })
    expect(readable.steps[0].output).toMatchObject({ title: 'Original' })
    f.restrictField()
    const restricted = await f.runner.diagnostics(run)
    expect(restricted.valuesVisible).toBe(false)
    expect(JSON.stringify(restricted.steps)).not.toContain('Original')
    expect(await f.store.run('default', 1, id)).toEqual(run)
  })
  it('maps prior outputs, executes one branch, persists skipped steps and separates tests', async () => {
    const f = fixture(),
      { id } = await f.start()
    expect(await f.runner.tick()).toBe(1)
    const run = await f.store.run('default', 1, id),
      steps = JSON.parse(run.steps)
    expect(run.mode).toBe('test')
    expect(run.status).toBe('succeeded')
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0].data.title).toBe('Original')
    expect(steps.map((s: { status: string }) => s.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'skipped',
    ])
    expect(steps[0].startedAt).toBeTruthy()
    expect(steps[0].finishedAt).toBeTruthy()
    expect(await f.runner.tick()).toBe(0)
  })
  it('pins a draft snapshot and retains completed history after editing and publishing', async () => {
    const f = fixture(),
      { id, row } = await f.start()
    await f.runner.tick()
    const before = await f.store.run('default', 1, id)
    await f.store.save('default', 1, {
      id: row.id,
      revision: row.revision,
      name: 'Renamed',
      definition: { trigger: { kind: 'manual' }, steps: [] },
    })
    expect(await f.store.run('default', 1, id)).toEqual(before)
    await expect(
      f.db.prepare("UPDATE vc_automation_runs SET definition='{}' WHERE id=?").bind(id).run(),
    ).rejects.toThrow()
    await expect(
      f.db.prepare("UPDATE vc_automation_runs SET steps='[]' WHERE id=?").bind(id).run(),
    ).rejects.toThrow()
  })
  it('scopes workflows and history by site and owner and rejects stale edits', async () => {
    const f = fixture(),
      { row, id } = await f.start()
    expect(await f.store.list('other', 1)).toEqual([])
    expect(await f.store.list('default', 2)).toEqual([])
    await expect(f.store.get('default', 2, row.id)).rejects.toThrow('unavailable')
    await expect(f.store.run('other', 1, id)).rejects.toThrow('unavailable')
    await expect(
      f.store.save('default', 1, {
        id: row.id,
        revision: 0,
        name: 'stale',
        definition: f.definition,
      }),
    ).rejects.toThrow('changed')
  })
  it('denies revoked owners before execution and hides historical data', async () => {
    const f = fixture(),
      { id } = await f.start()
    f.revoke()
    await f.runner.tick()
    const run = await f.store.run('default', 1, id)
    expect(run.status).toBe('failed')
    expect(f.writes).toHaveLength(0)
    const detail = await f.runner.diagnostics(run)
    expect(detail.definition).toBeNull()
    expect(detail.refs).toEqual([])
    expect(JSON.stringify(detail)).not.toContain('Original')
  })
  it('rechecks permission between blocks and never executes subsequent writes', async () => {
    const f = fixture(),
      original = f.adapter.execute
    f.adapter.execute = async (...args) => {
      const result = await original(...args)
      f.revoke()
      return result
    }
    const { id } = await f.start()
    await f.runner.tick()
    expect((await f.store.run('default', 1, id)).status).toBe('failed')
    expect(f.writes).toHaveLength(0)
  })
  it('does not use a cached mapped field after field permission is revoked', async () => {
    const f = fixture(),
      original = f.adapter.execute
    f.adapter.execute = async (...args) => {
      const result = await original(...args)
      f.restrictField()
      return result
    }
    const { id } = await f.start()
    await f.runner.tick()
    const run = await f.store.run('default', 1, id)
    expect(run.status).toBe('failed')
    expect(f.writes).toHaveLength(0)
    expect(JSON.parse(run.steps)[2].error).toContain('mapped field')
  })
  it('retries reads at most three times and reports the exact failed block', async () => {
    const f = fixture()
    let attempts = 0
    f.adapter.execute = async () => {
      attempts++
      throw Error('Transient database failure with secret token')
    }
    const { id } = await f.start()
    await f.runner.tick()
    const run = await f.store.run('default', 1, id),
      steps = JSON.parse(run.steps)
    expect(attempts).toBe(3)
    expect(steps[0].status).toBe('failed')
    expect(steps[0].attempts).toBe(3)
    expect(steps[1].status).toBe('unexecuted')
    expect(run.error).not.toContain('secret token')
  })
  it('never retries a mutation after an ambiguous failure', async () => {
    const f = fixture()
    let attempts = 0
    f.adapter.execute = async () => {
      attempts++
      throw Error('Connection lost after write')
    }
    const { id } = await f.start({
      trigger: { kind: 'manual' },
      steps: [
        f.definition.steps[2] && {
          ...f.definition.steps[2],
          when: undefined,
          data: { title: 'Follow up' },
        },
      ],
    })
    await f.runner.tick()
    expect(attempts).toBe(1)
    expect((await f.store.run('default', 1, id)).status).toBe('failed')
  })
  it('supports queued cancellation and records a cancellation between steps', async () => {
    const f = fixture(),
      { id } = await f.start()
    await f.store.cancel('default', 1, id)
    expect(await f.runner.tick()).toBe(0)
    expect((await f.store.run('default', 1, id)).status).toBe('canceled')
    const second = await f.start(),
      original = f.adapter.execute
    f.adapter.execute = async (...args) => {
      const output = await original(...args)
      await f.store.cancel('default', 1, second.id)
      return output
    }
    await f.runner.tick()
    expect((await f.store.run('default', 1, second.id)).status).toBe('canceled')
    expect(f.writes).toHaveLength(0)
  })
  it('marks an expired execution uncertain without replaying writes', async () => {
    const f = fixture(),
      { id } = await f.start()
    await f.db
      .prepare(
        "UPDATE vc_automation_runs SET status='running',steps=json_set(steps,'$[0].status','running'),lease_until='2000-01-01' WHERE id=?",
      )
      .bind(id)
      .run()
    await f.runner.tick()
    const run = await f.store.run('default', 1, id)
    expect(run.status).toBe('failed')
    expect(run.error).toContain('may have committed')
    expect(JSON.parse(run.steps)[0].status).toBe('failed')
    expect(f.writes).toHaveLength(0)
  })
  it('captures events transactionally, deduplicates fan-out, and suppresses automation recursion', async () => {
    const f = fixture(),
      source = nativeAutomationSources[1]
    f.sqlite.exec(
      'CREATE TABLE review_tasks(id INTEGER PRIMARY KEY,automation_site TEXT,automation_origin TEXT,status TEXT,assignee_id INTEGER,priority TEXT,due_date TEXT,title TEXT,platform_mutation_proof TEXT)',
    )
    for (const sql of sourceTriggers(source)) f.sqlite.exec(sql)
    const row = await f.saved({
      trigger: { kind: 'updated', resource: 'review-tasks', field: 'status' },
      steps: [
        {
          id: 'find',
          name: 'Find',
          kind: 'find',
          resource: 'review-tasks',
          recordID: { $ref: 'trigger.id' },
        },
      ],
    })
    await f.store.control(row, 'publish')
    // A rollback must also roll back event creation.
    f.sqlite.exec(
      "BEGIN;INSERT INTO review_tasks(id,automation_site,automation_origin,status,assignee_id,priority,due_date,title) VALUES(1,'default',NULL,'open',NULL,'normal',NULL,'Test');ROLLBACK",
    )
    expect(
      (await f.db.prepare('SELECT count(*) AS n FROM vc_automation_events').first<{ n: number }>())
        .n,
    ).toBe(0)
    f.sqlite.exec(
      "INSERT INTO review_tasks(id,automation_site,automation_origin,status,assignee_id,priority,due_date,title) VALUES(1,'default',NULL,'open',NULL,'normal',NULL,'Test')",
    )
    f.sqlite.exec("UPDATE review_tasks SET status='done' WHERE id=1")
    await f.store.dispatch()
    await f.store.dispatch()
    expect(await f.store.runs(row)).toHaveLength(1)
    f.sqlite.exec(
      "UPDATE review_tasks SET automation_origin='automation:run:block',status='open' WHERE id=1",
    )
    expect(
      (await f.db.prepare('SELECT count(*) AS n FROM vc_automation_events').first<{ n: number }>())
        .n,
    ).toBe(2)
  })
  it('captures only committed CRM contact audits and excludes automation writes', async () => {
    const f = fixture()
    f.sqlite.exec(
      'CREATE TABLE vc_platform_audit(id TEXT,site_id TEXT,record_type TEXT,record_id TEXT,action TEXT,operation_key TEXT,actor_id INTEGER,created_at TEXT)',
    )
    f.sqlite.exec(contactAutomationTrigger)
    f.sqlite.exec(
      "INSERT INTO vc_platform_audit VALUES('a','default','constituent','contact1','contact.created','user:create',1,'2026-10-26');INSERT INTO vc_platform_audit VALUES('b','default','constituent','contact2','contact.created','automation-run-step',1,'2026-10-26')",
    )
    const events = await f.db.prepare('SELECT * FROM vc_automation_events').all()
    expect(events.results).toHaveLength(1)
    expect(events.results[0]).toMatchObject({
      actor: '1',
      resource: 'contacts',
      record_id: 'contact1',
    })
  })
  it('validates previous-step references and rejects prototype paths and unknown actions', () => {
    expect(() =>
      validateDefinition({
        trigger: { kind: 'manual' },
        steps: [
          {
            id: 'a',
            name: 'Invalid reference',
            kind: 'find',
            resource: 'posts',
            recordID: { $ref: 'steps.future.id' },
          },
        ],
      }),
    ).toThrow('earlier')
    expect(() =>
      validateDefinition({ trigger: { kind: 'manual' }, steps: [{ id: 'a', kind: 'webhook' }] }),
    ).toThrow('supported')
    expect(() => resolve({ $ref: 'trigger.constructor.name' }, { trigger: { id: 1 } })).toThrow(
      'unavailable',
    )
    expect(mask({ token: 'abc', profile: { password: 'hidden', name: 'safe' } })).toEqual({
      token: '[masked]',
      profile: { password: '[masked]', name: 'safe' },
    })
  })
})
