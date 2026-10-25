import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { crmTimelineSchema } from '../helpers/crm-timeline-fixture'
import { applyCRMTaskSchemaV1 } from '@/crm/task-schema-v1'
import { CRMTasks } from '@/crm/tasks'
import { ContactRepository } from '@/crm/contacts'
import { OrganizationRepository } from '@/organizations/repository'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { ContactTimeline } from '@/crm/timeline'
import {
  workspaceProjectionSchemaV1,
  workspaceProjectionBackfillV1,
} from '@/organizations/workspace-projection-v1'

let payload: Payload, db: D1Database, actor: number, assignee: number, contact: string
describe.skipIf(!process.env.E2E_TEST_PERSIST_PATH?.includes('crm-task-native-bridge-'))(
  'Native CRM Tasks bridge',
  () => {
    beforeAll(async () => {
      if (!process.env.E2E_TEST_PERSIST_PATH?.includes('crm-task-native-bridge-'))
        throw new Error('Native CRM Tasks checks require their explicit isolated local database.')
      payload = await getPayload({ config })
      db = (payload.db as unknown as { client: D1Database }).client
      const suffix = Date.now()
      const users = []
      for (const [index, role] of ['administrator', 'editor'].entries())
        users.push(
          await payload.create({
            collection: 'users',
            data: {
              username: `crm-task-${suffix}-${index}`,
              email: `crm-task-${suffix}-${index}@example.invalid`,
              password: 'fictional-task-password',
              role: role as 'administrator' | 'editor',
            },
          }),
        )
      actor = users[0].id
      assignee = users[1].id
      for (const statement of crmTimelineSchema) await db.prepare(statement).run()
      for (const table of ['vc_crm_task_contexts', 'vc_crm_task_constituents']) {
        const physical = await db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .bind(table)
          .first()
        if (!physical) continue
        expect(
          (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n,
        ).toBe(0)
        await db.prepare(`DROP TABLE ${table}`).run()
      }
      for (const statement of [...workspaceProjectionSchemaV1, ...workspaceProjectionBackfillV1])
        await db.prepare(statement).run()
      await applyCRMTaskSchemaV1(
        async (statement) => db.prepare(statement).run(),
        async (table = 'review_tasks') =>
          (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results,
        async () =>
          (
            await db
              .prepare("SELECT name FROM sqlite_master WHERE type='table'")
              .all<{ name: string }>()
          ).results,
      )
      const site = await db
        .prepare("SELECT revision FROM vc_sites WHERE id='default'")
        .first<{ revision: number }>()
      await new OrganizationRepository(db, actor).setMembership({
        site: 'default',
        user: assignee,
        role: 'editor',
        active: true,
        expectedRevision: site!.revision,
        operationKey: crypto.randomUUID(),
      })
      contact = String(
        (
          await new ContactRepository(db, actor).create({
            site: 'default',
            profile: { kind: 'person', firstName: 'Fictional follow-up donor' },
            roles: ['donor', 'volunteer'],
            operationKey: crypto.randomUUID(),
          })
        ).id,
      )
    }, 180000)

    it('creates, assigns, lists and completes an existing native Task with live CRM joins and revocation', async () => {
      const user = await payload.findByID({ collection: 'users', id: actor, depth: 0 })
      const req = await createLocalReq(
        { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
      const service = new CRMTasks(db, req),
        link = { type: 'contact' as const, id: contact }
      const before = await service.list('default', link)
      const operationKey = crypto.randomUUID()
      const intent = {
        site: 'default',
        link,
        expectedRevision: before.record.revision,
        expectedAuthorityRevision: before.authorityRevision,
        operationKey,
        title: 'Fictional assigned donor follow-up',
        assignee,
      }
      const created = await service.create(intent)
      expect((await service.create(intent)).id).toBe(created.id)
      const listed = await service.list('default', link)
      expect(listed.total).toBe(1)
      expect(listed.docs[0]).toMatchObject({
        id: created.id,
        title: intent.title,
        assignee,
        crmType: 'contact',
        crmID: contact,
      })
      const target = await payload.findByID({ collection: 'users', id: assignee, depth: 0 })
      const targetReq = await createLocalReq(
        { user: { ...target, collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
      // The Tasks service pins and witnesses the chapter before passing native requests.
      const targetService = new CRMTasks(db, targetReq)
      expect((await targetService.list('default', link)).total).toBe(1)
      const stored = await payload.findByID({
        collection: 'review-tasks',
        id: created.id,
        depth: 0,
      })
      await payload.update({
        collection: 'review-tasks',
        id: created.id,
        data: { status: 'done', expectedUpdatedAt: stored.updatedAt },
        req: targetReq,
        overrideAccess: false,
        depth: 0,
      })
      expect((await service.list('default', link, 1, 'completed')).total).toBe(1)
      const history = await new ContactTimeline(db, assignee).list({
        site: 'default',
        contact,
        group: 'tasks',
      })
      expect(history.docs.map((row) => row.title).sort()).toEqual([
        'Follow-up completed',
        'Follow-up created',
      ])
      expect(history.docs.every((row) => row.targetID === String(created.id))).toBe(true)
      expect(
        (await db
          .prepare("SELECT actor_id FROM vc_crm_task_events WHERE task_id=? AND kind='completed'")
          .bind(created.id)
          .first<{ actor_id: number }>())!.actor_id,
      ).toBe(assignee)
      await db
        .prepare(
          'UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?',
        )
        .bind(contact)
        .run()
      await expect(service.list('default', link)).rejects.toThrow()
      const count = await payload.count({
        collection: 'review-tasks',
        req,
        overrideAccess: false,
        where: { id: { equals: created.id } },
      })
      expect(count.totalDocs).toBe(0)
    }, 180000)
  },
)
