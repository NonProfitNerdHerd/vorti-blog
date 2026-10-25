import { expect, it, vi } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { CRMJobs, type CRMJobHandler } from '../../src/crm/jobs'
import {
  consumeCRMJobWakes,
  recoverCRMJobWakes,
  wakeCRMJob,
  type CRMJobWake,
} from '../../src/crm/job-dispatch'
const message = (body: unknown) => ({ body, ack: vi.fn(), retry: vi.fn() })
const batch = (entry: ReturnType<typeof message>) =>
  ({ messages: [entry] }) as unknown as Pick<MessageBatch<unknown>, 'messages'>

it('recovers a lost publish acknowledgement without duplicate checkpoints and sends IDs only', async () => {
  const fixture = await crmTimelineFixture()
  try {
    fixture.sqlite.exec('CREATE TABLE fictional_dispatch_steps(step INTEGER PRIMARY KEY)')
    const queued = await new CRMJobs(fixture.db).enqueue({
        actor: 1,
        site: 'default',
        kind: 'import-apply',
        payload: { private: 'must stay in D1' },
        operationKey: crypto.randomUUID(),
      }),
      id = String(queued.id),
      pending: CRMJobWake[] = []
    let loseAck = true
    const queue = {
      send: async (body: CRMJobWake) => {
        pending.push(body)
        if (loseAck) {
          loseAck = false
          throw Error('Uncertain publish')
        }
      },
    }
    const handler: CRMJobHandler = {
      async prepare(job) {
        const step = Number(job.cursor || 0) + 1
        return {
          writes: [
            fixture.db.prepare('INSERT INTO fictional_dispatch_steps(step) VALUES(?)').bind(step),
          ],
          cursor: String(step),
          processed: 1,
          done: step === 3,
        }
      },
    }
    const original = message({ v: 1, job: id })
    await consumeCRMJobWakes(batch(original), fixture.db, queue, { 'import-apply': handler })
    expect(original.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    expect(original.ack).not.toHaveBeenCalled()
    // The uncertain publish was actually delivered, along with the original retry.
    const retry = message(original.body)
    await consumeCRMJobWakes(batch(retry), fixture.db, queue, { 'import-apply': handler })
    for (let index = 0; index < pending.length; index++)
      await consumeCRMJobWakes(batch(message(pending[index])), fixture.db, queue, {
        'import-apply': handler,
      })
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM fictional_dispatch_steps').get()!.n,
    ).toBe(3)
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(id)!.status,
    ).toBe('completed')
    expect(pending.every((body) => Object.keys(body).sort().join(',') === 'job,v')).toBe(true)
    expect(await recoverCRMJobWakes(fixture.db, queue, ['import-apply'])).toBe(0)
    const forged = message({ v: 1, job: id, actor: 999 })
    await consumeCRMJobWakes(batch(forged), fixture.db, queue, { 'import-apply': handler })
    expect(forged.ack).toHaveBeenCalledOnce()
  } finally {
    fixture.close()
  }
})

it('recovers eligible jobs and expired leases, excludes active leases, and fails visibly on queue outage', async () => {
  const fixture = await crmTimelineFixture()
  try {
    const jobs = new CRMJobs(fixture.db),
      ids: string[] = []
    for (let index = 0; index < 3; index++)
      ids.push(
        String(
          (
            await jobs.enqueue({
              actor: 1,
              site: 'default',
              kind: 'import-apply',
              payload: {},
              operationKey: crypto.randomUUID(),
            })
          ).id,
        ),
      )
    fixture.sqlite
      .prepare("UPDATE vc_crm_jobs SET status='running',lease_until=? WHERE id=?")
      .run(new Date(Date.now() + 60000).toISOString(), ids[1])
    fixture.sqlite
      .prepare("UPDATE vc_crm_jobs SET status='running',lease_until=? WHERE id=?")
      .run(new Date(Date.now() - 1000).toISOString(), ids[2])
    const delivered: string[] = [],
      queue = {
        send: async (body: CRMJobWake) => {
          delivered.push(body.job)
        },
      }
    expect(await recoverCRMJobWakes(fixture.db, queue, ['import-apply'])).toBe(2)
    expect(new Set(delivered)).toEqual(new Set([ids[0], ids[2]]))
    await expect(
      recoverCRMJobWakes(
        fixture.db,
        {
          send: async () => {
            throw Error('offline')
          },
        },
        ['import-apply'],
      ),
    ).rejects.toThrow('incomplete')
    await expect(wakeCRMJob(undefined, ids[0])).rejects.toThrow('not configured')
    await expect(wakeCRMJob(queue, 'invalid/job')).rejects.toThrow('valid CRM job')
  } finally {
    fixture.close()
  }
})
