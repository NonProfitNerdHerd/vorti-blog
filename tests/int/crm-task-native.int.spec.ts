import { grantFixtureMembership } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { crmTimelineSchema } from '../helpers/crm-timeline-fixture'
import { applyCRMTaskSchemaV1 } from '@/crm/task-schema-v1'
import { CRMTasks } from '@/crm/tasks'
import { ContactRepository } from '@/crm/contacts'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { ContactTimeline } from '@/crm/timeline'
import { workspaceEndpoint } from '@/review/workspace-service'
import { boardActivity } from '@/review/board-overview-service'

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
      await grantFixtureMembership(payload, users[0], 'administrator')
      await grantFixtureMembership(payload, users[1], 'editor')
      actor = users[0].id
      assignee = users[1].id
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
      const boardReq = await createLocalReq(
        { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
      const board = await payload.create({
        collection: 'task-boards',
        req: boardReq,
        overrideAccess: false,
        data: { name: 'Fictional CRM follow-ups', visibility: 'private', owner: actor },
      })
      const sharing = await createLocalReq(
        { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
        payload,
      )
      sharing.routeParams = { id: String(created.id) }
      sharing.json = async () => ({ action: 'share', board: board.id, confirm: true })
      expect((await workspaceEndpoint.handler(sharing)).ok).toBe(true)
      const activity = await boardActivity(
        boardReq,
        String(board.id),
        new URLSearchParams({ limit: '100' }),
      )
      expect(activity.docs.some((row) => row.task === created.id)).toBe(true)
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
      const revokedActivity = await boardActivity(
        boardReq,
        String(board.id),
        new URLSearchParams({ limit: '100' }),
      )
      expect(revokedActivity.docs.every((row) => row.task !== created.id)).toBe(true)
      expect(JSON.stringify(revokedActivity)).not.toContain(intent.title)
    }, 180000)
  },
)
