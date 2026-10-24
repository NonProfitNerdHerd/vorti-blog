import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { atomicSiteMutation, SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import type { InformationCategory, SiteOperation } from '../organizations/policy'

export const jobPermissions = {
  'report-export': { category: 'reports', operation: 'export' },
  'import-apply': { category: 'identity', operation: 'edit' },
  'contact-merge': { category: 'identity', operation: 'edit' },
  correspondence: { category: 'communications', operation: 'edit' },
} as const satisfies Record<string, { category: InformationCategory; operation: SiteOperation }>
export type CRMJobKind = keyof typeof jobPermissions
export interface CRMJob {
  id: string
  site_id: string
  actor_id: number
  kind: CRMJobKind
  payload: string
  cursor: string
  progress: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  fence: number
  attempts: number
  lease_until: string | null
}
export interface JobStep {
  /** Domain writes must be repeat-safe and run inside the checkpoint transaction. */
  writes: D1PreparedStatement[]
  cursor: string
  processed: number
  done: boolean
  result?: Record<string, unknown>
  /** R2 staging may precede the D1 checkpoint; cleanup must discard uncommitted objects. */
  abandon?: () => Promise<void>
}
export interface CRMJobHandler {
  /** Recheck domain-specific permissions, record revisions and reviewed approval here on every batch. */
  prepare(job: CRMJob): Promise<JobStep>
}
const kindOf = (kind: string): CRMJobKind => {
  if (!Object.hasOwn(jobPermissions, kind)) throw new Error('Choose a supported CRM job.')
  return kind as CRMJobKind
}
/** Durable D1 leases and monotonic fences. Domain handlers never commit outside the checkpoint batch. */
export class CRMJobs {
  constructor(
    private db: D1Database,
    private now: () => number = Date.now,
  ) {}
  async enqueue(input: {
    actor: number
    site: string
    kind: CRMJobKind
    payload: Record<string, unknown>
    operationKey: string
  }) {
    const kind = kindOf(input.kind),
      permission = jobPermissions[kind]
    const site = await new OrganizationRepository(this.db, input.actor).require(
      input.site,
      permission.category,
      permission.operation,
    )
    const payload = JSON.stringify(input.payload)
    if (payload.length > 24000) throw new Error('Choose a smaller CRM job request.')
    const intent = { kind, payload: input.payload }
    const replay = await replayCRM(this.db, input.actor, input.operationKey, {
      site: input.site,
      action: 'job.queued',
      type: 'crm-job',
      intent,
    })
    if (replay) return replay
    const id = crypto.randomUUID(),
      now = new Date(this.now()).toISOString()
    return commitCRM({
      db: this.db,
      actor: input.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'job.queued',
      type: 'crm-job',
      id,
      after: { id, kind },
      intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(id, input.site, input.actor, kind, payload, now, now, now),
      result: { id },
    })
  }
  async cancel(actor: number, siteID: string, id: string, operationKey: string) {
    const job = await this.db
      .prepare('SELECT * FROM vc_crm_jobs WHERE id=? AND site_id=? AND actor_id=?')
      .bind(id, siteID, actor)
      .first<CRMJob>()
    if (!job) throw new SiteAccessError()
    const permission = jobPermissions[kindOf(job.kind)],
      site = await new OrganizationRepository(this.db, actor).require(
        siteID,
        permission.category,
        permission.operation,
      )
    const intent = { id },
      replay = await replayCRM(this.db, actor, operationKey, {
        site: siteID,
        action: 'job.cancelled',
        type: 'crm-job',
        intent,
      })
    if (replay) return replay
    return commitCRM({
      db: this.db,
      actor,
      key: operationKey,
      site: siteID,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'job.cancelled',
      type: 'crm-job',
      id,
      before: { status: job.status },
      after: { status: 'cancelled' },
      intent,
      write: this.db
        .prepare(
          "UPDATE vc_crm_jobs SET status='cancelled',fence=fence+1,lease_until=NULL,updated_at=? WHERE id=? AND actor_id=? AND status IN('pending','running','failed')",
        )
        .bind(new Date(this.now()).toISOString(), id, actor),
      result: { id },
    })
  }
  async tick(handlers: Partial<Record<CRMJobKind, CRMJobHandler>>): Promise<boolean> {
    // Never claim an unsupported kind: another runner may own it.
    const kinds = Object.keys(handlers).map(kindOf)
    if (!kinds.length) return false
    const now = new Date(this.now()).toISOString(),
      lease = new Date(this.now() + 120000).toISOString()
    const candidate = await this.db
      .prepare(
        `SELECT id,fence FROM vc_crm_jobs WHERE kind IN(${kinds.map(() => '?').join(',')})
      AND next_attempt_at<=? AND (status='pending' OR (status='running' AND lease_until<=?)) ORDER BY next_attempt_at,id LIMIT 1`,
      )
      .bind(...kinds, now, now)
      .first<{ id: string; fence: number }>()
    if (!candidate) return false
    const claimed = await this.db
      .prepare(
        "UPDATE vc_crm_jobs SET status='running',fence=fence+1,attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND fence=? AND (status='pending' OR (status='running' AND lease_until<=?))",
      )
      .bind(lease, now, candidate.id, candidate.fence, now)
      .run()
    if (claimed.meta.changes !== 1) return false
    const job = await this.db
      .prepare("SELECT * FROM vc_crm_jobs WHERE id=? AND fence=? AND status='running'")
      .bind(candidate.id, candidate.fence + 1)
      .first<CRMJob>()
    if (!job) throw new SiteConflictError()
    let step: JobStep | undefined
    try {
      const permission = jobPermissions[kindOf(job.kind)]
      const site = await new OrganizationRepository(this.db, job.actor_id).require(
        job.site_id,
        permission.category,
        permission.operation,
      )
      step = await handlers[job.kind]!.prepare(job)
      if (
        !Number.isSafeInteger(step.processed) ||
        step.processed < 0 ||
        step.cursor.length > 4000 ||
        step.writes.length > 50 ||
        (!step.done && step.cursor === job.cursor)
      )
        throw new Error('Invalid CRM job checkpoint.')
      const key = crypto.randomUUID(),
        timestamp = new Date(this.now()).toISOString()
      // Put the guarded checkpoint first: a cancelled/expired/reclaimed worker cannot write domain rows.
      await atomicSiteMutation(this.db, {
        actor: job.actor_id,
        operationKey: key,
        fingerprint: '0'.repeat(64),
        result: { id: job.id, fence: job.fence },
        write: this.db
          .prepare(
            'UPDATE vc_crm_jobs SET cursor=?,progress=progress+?,status=?,result=?,error=NULL,attempts=0,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND fence=? AND status=? AND lease_until>?',
          )
          .bind(
            step.cursor,
            step.processed,
            step.done ? 'completed' : 'pending',
            step.result ? JSON.stringify(step.result) : null,
            timestamp,
            timestamp,
            job.id,
            job.fence,
            'running',
            timestamp,
          ),
        afterWrite: [
          this.db
            .prepare(
              'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
            )
            .bind(`${key}:authority`, site.organization_id, site.authorityRevision),
          this.db
            .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
            .bind(`${key}:authority`),
          ...step.writes,
        ],
      })
      return true
    } catch (error) {
      if (step?.abandon) await step.abandon()
      const terminal = error instanceof SiteAccessError || job.attempts >= 5
      const next = new Date(this.now() + Math.min(3600000, 1000 * 2 ** job.attempts)).toISOString()
      await this.db
        .prepare(
          "UPDATE vc_crm_jobs SET status=?,error=?,next_attempt_at=?,lease_until=NULL,updated_at=? WHERE id=? AND fence=? AND status='running'",
        )
        .bind(
          terminal ? 'failed' : 'pending',
          error instanceof SiteAccessError
            ? 'Access changed. Review authorization before retrying.'
            : 'Processing failed. Review the job before retrying.',
          next,
          new Date(this.now()).toISOString(),
          job.id,
          job.fence,
        )
        .run()
      return true
    }
  }
}
