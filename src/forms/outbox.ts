import type { FormAction } from '@design-system/payload-design-core/forms'
import { FormHTTPError } from './security'
import { featureAvailableAt } from '../organizations/tenant-runtime'

export interface OutboxJob {
  id: number; site: string; event_i_d: string; submission_i_d: string; revision: string
  kind: string; payload: string; attempts: number; attempt_log: string | null
}
export interface ActionContext { job: OutboxJob; action: FormAction }
export type ActionHandler = (context: ActionContext) => Promise<void>
export class UnconfiguredAction extends Error {}
export class PermanentActionError extends Error {}
/** Server-only extension registry. Register real handlers, never client-supplied executable code. */
export class ActionHandlers {
  private handlers = new Map<string, ActionHandler>()
  register(kind: string, handler: ActionHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Action handler already registered: ${kind}`)
    this.handlers.set(kind, handler)
  }
  async dispatch(job: OutboxJob): Promise<void> {
    const handler = this.handlers.get(job.kind)
    if (!handler) throw new UnconfiguredAction('No configured provider for this action.')
    const { action } = JSON.parse(job.payload) as { action: FormAction }
    if (action.kind !== job.kind) throw new PermanentActionError('Action configuration is invalid.')
    await handler({ job, action })
  }
}

export class FormOutbox {
  constructor(private db: D1Database, private handlers: ActionHandlers, private now = () => Date.now(), private allowSimulatedPayments = false) {}

  async run(site: string, limit = 10): Promise<number> {
    let processed = 0
    for (; processed < Math.max(1, Math.min(limit, 50)); processed++) {
      const started = this.now(), now = new Date(started).toISOString()
      // One atomic claim. The attempt counter also fences an expired worker from completing a newer claim.
      const job = await this.db.prepare(`UPDATE form_outbox SET status='running', attempts=COALESCE(attempts,0)+1, lease_until=?, updated_at=? WHERE id=(SELECT id FROM form_outbox WHERE site=? AND ((status='pending' AND next_attempt_at<=?) OR (status='running' AND lease_until<=?)) AND (COALESCE(json_extract(payload,'$.action.requiresPayment'),0)!=1 OR EXISTS(SELECT 1 FROM form_submissions s WHERE CAST(s.id AS TEXT)=submission_i_d AND s.site=form_outbox.site AND (s.payment_status='paid' OR (?=1 AND s.payment_status='simulated')))) ORDER BY next_attempt_at, id LIMIT 1) RETURNING *`).bind(new Date(started + 60000).toISOString(), now, site, now, now, this.allowSimulatedPayments ? 1 : 0).first<OutboxJob>()
      if (!job) break
      const retryFrom = Number((JSON.parse(job.payload) as { retryFrom?: number }).retryFrom || 0)
      const cycleAttempt = job.attempts - retryFrom
      let status = 'complete', result = 'Delivered', next: string | null = null
      try {
        if (!(await featureAvailableAt(this.db, site, 'forms')))
          throw new PermanentActionError('Forms is disabled. Delivery requires explicit review and replay.')
        const host = (JSON.parse(job.payload) as {hostFeature?: 'pages' | 'posts' | 'wiki' | 'intranet'}).hostFeature
        if (host && (!['pages', 'posts', 'wiki', 'intranet'].includes(host) || !await featureAvailableAt(this.db, site, host)))
          throw new PermanentActionError('The form host is disabled. Delivery requires explicit review and replay.')
        if (cycleAttempt > 8) throw new PermanentActionError('Retry limit reached after an interrupted worker.')
        await this.handlers.dispatch(job)
      } catch (error) {
        if (error instanceof UnconfiguredAction) { status = 'unconfigured'; result = error.message }
        else if (error instanceof PermanentActionError) { status = 'failed'; result = error.message }
        else {
          status = cycleAttempt >= 8 ? 'failed' : 'pending'
          // Do not persist arbitrary provider errors: they can contain credentials, answers or recipient data.
          result = 'Delivery failed. Check the provider configuration or retry after service recovery.'
          next = new Date(this.now() + Math.min(3600000, 5000 * 2 ** (cycleAttempt - 1))).toISOString()
        }
      }
      const history = JSON.parse(job.attempt_log || '[]') as unknown[]
      history.push({ attempt: job.attempts, startedAt: now, finishedAt: new Date(this.now()).toISOString(), status, result })
      await this.db.prepare(`UPDATE form_outbox SET status=?, next_attempt_at=?, lease_until=NULL, attempt_log=?, updated_at=? WHERE id=? AND site=? AND status='running' AND attempts=?`).bind(status, next, JSON.stringify(history.slice(-50)), new Date(this.now()).toISOString(), job.id, site, job.attempts).run()
    }
    return processed
  }

  async replay(site: string, id: number): Promise<void> {
    // Never reset the fencing counter: a delayed worker from before replay must remain stale.
    const result = await this.db.prepare(`UPDATE form_outbox SET status='pending', payload=json_set(payload, '$.retryFrom', COALESCE(attempts,0)), next_attempt_at=?, lease_until=NULL, updated_at=? WHERE id=? AND site=? AND status IN ('failed','unconfigured')`).bind(new Date(this.now()).toISOString(), new Date(this.now()).toISOString(), id, site).run()
    if (result.meta.changes !== 1) throw new FormHTTPError('Only failed or unconfigured actions can be replayed. Completed actions are not repeated.', 409)
  }
}
