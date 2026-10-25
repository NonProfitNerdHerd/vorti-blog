import { CRMJobs, type CRMJobHandler, type CRMJobKind } from './jobs'

export type CRMJobWake = { v: 1; job: string }
type Producer = Pick<Queue<CRMJobWake>, 'send'>
type Handlers = Partial<Record<CRMJobKind, CRMJobHandler>>
const validID = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

/** Producer bodies intentionally contain no actor, chapter, source rows or credentials. */
export async function wakeCRMJob(queue: Producer | undefined, job: string): Promise<void> {
  if (!queue) throw Error('CRM background dispatch is not configured.')
  if (!validID(job)) throw Error('Choose a valid CRM job.')
  await queue.send({ v: 1, job })
}

/** One fenced checkpoint per message bounds work. Publish continuation before
 * acknowledging; a lost publish acknowledgement may duplicate wakes, not writes.
 * Running leases are left alone; scheduled recovery finds abandoned leases. */
export async function consumeCRMJobWakes(
  batch: Pick<MessageBatch<unknown>, 'messages'>,
  db: D1Database,
  queue: Producer,
  handlers: Handlers,
  now: () => number = Date.now,
): Promise<void> {
  const runner = new CRMJobs(db, now)
  for (const message of batch.messages) {
    const body = message.body
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'job,v' ||
      (body as CRMJobWake).v !== 1 ||
      !validID((body as CRMJobWake).job)
    ) {
      message.ack()
      continue
    }
    const id = (body as CRMJobWake).job
    try {
      const before = await db
        .prepare('SELECT kind FROM vc_crm_jobs WHERE id=?')
        .bind(id)
        .first<{ kind: CRMJobKind }>()
      if (!before || !Object.hasOwn(handlers, before.kind)) {
        message.ack()
        continue
      }
      await runner.tick(handlers, id)
      const current = await db
        .prepare('SELECT status,next_attempt_at FROM vc_crm_jobs WHERE id=?')
        .bind(id)
        .first<{ status: string; next_attempt_at: string }>()
      if (current?.status === 'pending') {
        const target = Date.parse(current.next_attempt_at)
        if (!Number.isFinite(target)) throw Error('Invalid CRM job retry time.')
        const delaySeconds = Math.max(0, Math.min(86400, Math.ceil((target - now()) / 1000)))
        await queue.send({ v: 1, job: id }, { delaySeconds })
      }
      message.ack()
    } catch {
      // No private job payload or provider error reaches logs/queue bodies.
      message.retry({ delaySeconds: 30 })
    }
  }
}

/** Cron is the safety net for a process dying between checkpoint and publish,
 * exhausted Queue delivery, producer outage, or an expired processing lease. */
export async function recoverCRMJobWakes(
  db: D1Database,
  queue: Producer,
  kinds: CRMJobKind[],
  now = Date.now(),
): Promise<number> {
  if (!kinds.length) return 0
  const timestamp = new Date(now).toISOString()
  const rows = await db
    .prepare(
      `SELECT id FROM vc_crm_jobs WHERE kind IN(${kinds.map(() => '?').join(',')}) AND next_attempt_at<=?
    AND(status='pending' OR(status='running' AND lease_until<=?)) ORDER BY next_attempt_at,id LIMIT 25`,
    )
    .bind(...kinds, timestamp, timestamp)
    .all<{ id: string }>()
  const results = await Promise.allSettled(rows.results.map((job) => wakeCRMJob(queue, job.id)))
  if (results.some((result) => result.status === 'rejected'))
    throw Error('CRM job recovery dispatch is incomplete.')
  return rows.results.length
}
