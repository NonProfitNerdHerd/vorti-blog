import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { grantFixtureMembership } from '../helpers/native-authority'
import { AutomationStore } from '@/automations/store'
import { AutomationRunner, payloadAdapter } from '@/automations/runtime'
import type { User } from '@/payload-types'
import { acceptSubmission, type Acceptance } from '@/forms/acceptance'
import { ContactRepository } from '@/crm/contacts'

describe('Automations with native Payload authorization and migrated D1', () => {
  let payload: Payload,
    db: D1Database,
    owner: number,
    other: number,
    board: number,
    privateBoard: number,
    store: AutomationStore,
    runner: AutomationRunner
  beforeAll(async () => {
    payload = await getPayload({ config })
    db = (payload.db as unknown as { client: D1Database }).client
    const users: User[] = []
    for (let i = 0; i < 2; i++) {
      const user = await payload.create({
        collection: 'users',
        data: {
          username: `automation-${i}`,
          email: `automation-${i}@example.invalid`,
          password: 'fictional-local-password',
          role: 'editor',
        },
      })
      await grantFixtureMembership(payload, user, 'editor')
      users.push(user)
    }
    owner = users[0].id
    other = users[1].id
    const req = async (index: number) =>
      createLocalReq(
        { user: { ...users[index], collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(0),
        overrideAccess: false,
        data: { name: 'Automation board', owner, visibility: 'private' },
      })
    ).id
    privateBoard = (
      await payload.create({
        collection: 'task-boards',
        req: await req(1),
        overrideAccess: false,
        data: { name: 'Inaccessible board', owner: other, visibility: 'private' },
      })
    ).id
    store = new AutomationStore(db)
    runner = new AutomationRunner(store, payloadAdapter(payload, db))
  }, 180000)
  it('creates a board item with actual hooks, suppresses recursive events and retains versioned history', async () => {
    const workflow = await store.save('default', owner, {
      name: 'Create a follow-up',
      definition: {
        trigger: { kind: 'manual' },
        steps: [
          {
            id: 'task',
            name: 'Create follow-up',
            kind: 'create',
            resource: 'review-tasks',
            data: {
              title: 'Automated native follow-up',
              initialBoard: board,
              status: 'open',
              priority: 'normal',
            },
          },
        ],
      },
    })
    const published = await store.control(workflow, 'publish'),
      id = await store.enqueue(published, 'live', { id: crypto.randomUUID(), input: {} })
    await runner.tick(1, id)
    const run = await store.run('default', owner, id)
    expect(run.status, run.error || run.steps).toBe('succeeded')
    const refs = JSON.parse(run.refs),
      task = await db
        .prepare('SELECT title,automation_origin FROM review_tasks WHERE id=?')
        .bind(Number(refs[0].id))
        .first<{ title: string; automation_origin: string }>()
    expect(task.title).toBe('Automated native follow-up')
    expect(task.automation_origin).toContain(`automation-${id}-task`)
    const events = await db
      .prepare(
        "SELECT count(*) AS n FROM vc_automation_events WHERE resource='review-tasks' AND record_id=?",
      )
      .bind(refs[0].id)
      .first<{ n: number }>()
    expect(events.n).toBe(0)
    expect(
      await db
        .prepare('SELECT definition FROM vc_automation_versions WHERE automation=? AND version=1')
        .bind(workflow.id)
        .first(),
    ).toBeTruthy()
  })
  it('turns an accepted form submission into a CRM contact once through the existing primitives', async () => {
    const user = await payload.findByID({ collection: 'users', id: owner, depth: 0 })
    const req = await createLocalReq(
      { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
      payload,
    )
    const form = await payload.create({
      collection: 'forms',
      req,
      overrideAccess: false,
      draft: true,
      data: { title: 'Automation source form', slug: 'automation-source' },
    })
    const workflow = await store.save('default', owner, {
      name: 'Submission to CRM',
      definition: {
        trigger: { kind: 'created', resource: 'form-submissions' },
        steps: [
          {
            id: 'contact',
            name: 'Create CRM contact',
            kind: 'create',
            resource: 'contacts',
            data: {
              profile: { kind: 'person', firstName: { $ref: 'trigger.answers.firstName' } },
              roles: ['donor'],
            },
          },
        ],
      },
    })
    const published = await store.control(workflow, 'publish')
    const input: Acceptance = {
      formID: form.id,
      site: 'default',
      revision: 'automation-fixture',
      key: 'automation-submission',
      sessionHash: 'fictional-session',
      answers: { firstName: 'Fictional automation donor' },
      snapshot: {
        title: 'Automation source form',
        fields: [
          { id: 'firstName', kind: 'text' as const, label: 'First name', width: 12 as const },
        ],
      },
      actions: [],
      payment: false,
      attachments: [],
    }
    expect((await acceptSubmission(db, input)).created).toBe(true)
    expect((await acceptSubmission(db, input)).created).toBe(false)
    const runs = await store.runs(published)
    expect(runs).toHaveLength(1)
    const id = String(runs[0].id)
    await runner.tick(1, id)
    const run = await store.run('default', owner, id)
    expect(run.status, run.error || run.steps).toBe('succeeded')
    const result = JSON.parse(run.steps)[0]
    const contact = await new ContactRepository(db, owner).get('default', result.reference.id)
    expect(contact.label).toBe('Fictional automation donor')
    expect((await runner.diagnostics(run)).valuesVisible).toBe(true)
  })
  it('retains unauthorized blocks and fails a real write to an inaccessible board', async () => {
    const workflow = await store.save('default', owner, {
      name: 'Denied board',
      definition: {
        trigger: { kind: 'manual' },
        steps: [
          {
            id: 'task',
            name: 'Denied destination',
            kind: 'create',
            resource: 'review-tasks',
            data: { title: 'Must never exist', initialBoard: privateBoard },
          },
        ],
      },
    })
    const id = await store.enqueue(workflow, 'test', { id: crypto.randomUUID(), input: {} }, true)
    await runner.tick(1, id)
    const run = await store.run('default', owner, id)
    expect(run.status).toBe('failed')
    expect(JSON.parse(run.steps)[0].status).toBe('failed')
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM review_tasks WHERE title='Must never exist'")
          .first<{ n: number }>()
      ).n,
    ).toBe(0)
  })
  it('captures a human task change and executes a pinned published workflow after a later edit', async () => {
    const user = await payload.findByID({ collection: 'users', id: owner, depth: 0 })
    const req = () =>
      createLocalReq(
        { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
    const task = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      data: {
        title: 'Human created source',
        initialBoard: board,
        status: 'open',
        priority: 'normal',
      },
    })
    const workflow = await store.save('default', owner, {
      name: 'On status',
      definition: {
        trigger: {
          kind: 'updated',
          resource: 'review-tasks',
          field: 'status',
          recordID: String(task.id),
        },
        steps: [
          {
            id: 'find',
            name: 'Read source',
            kind: 'find',
            resource: 'review-tasks',
            recordID: { $ref: 'trigger.id' },
          },
        ],
      },
    })
    const published = await store.control(workflow, 'publish')
    await payload.update({
      collection: 'review-tasks',
      id: task.id,
      req: await req(),
      overrideAccess: false,
      data: { status: 'in-progress' },
    })
    const queued = await store.runs(published)
    expect(queued).toHaveLength(1)
    await store.save('default', owner, {
      id: published.id,
      revision: published.revision,
      name: 'Edited after event',
      definition: { trigger: { kind: 'manual' }, steps: [] },
    })
    await runner.tick(1, String(queued[0].id))
    const run = await store.run('default', owner, String(queued[0].id))
    expect(run.status, run.error || run.steps).toBe('succeeded')
    expect(JSON.parse(run.definition).trigger.kind).toBe('updated')
    expect(run.version).toBe(1)
  })
})
