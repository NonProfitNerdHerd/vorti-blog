import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { MergeAccess, type MergePair } from './merge-access'
import { prepareMergeProfile } from './merge-profile'
import { commitCRM, replayCRM } from './mutations'

export type MergeRequest = {
  id: string
  organization_id: string
  site_id: string
  actor_id: number
  survivor_id: string
  duplicate_id: string
  state: string
  revision: number
  review_id: string | null
  job_id: string | null
  created_at: string
  updated_at: string
}
type Pair = Awaited<ReturnType<MergeAccess['pair']>>
type Expected = { survivor: number; duplicate: number }

/** Request/review metadata only. Staff approval/publication stays unavailable
 * until the complete impact scanner and every live lineage integration exist. */
export class MergeRequests {
  private readonly access: MergeAccess
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
  ) {
    this.access = new MergeAccess(db, actor)
  }
  private expected(pair: Pair, expected: Expected) {
    if (
      ![expected.survivor, expected.duplicate].every(
        (revision) => Number.isSafeInteger(revision) && revision > 0,
      ) ||
      pair.survivor.revision !== expected.survivor ||
      pair.duplicate.revision !== expected.duplicate
    )
      throw new SiteConflictError()
  }
  private guards(site: string, pair: Pair, key: string) {
    return [
      this.db
        .prepare(
          `INSERT INTO vc_write_guards(operation_key,affected)
      SELECT ?,CASE WHEN count(*)=2 THEN 1 ELSE 0 END FROM vc_crm_constituents c
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id
      WHERE a.site_id=? AND c.archived=0 AND a.archived=0 AND
        ((c.id=? AND c.revision=? AND a.revision=?) OR(c.id=? AND c.revision=? AND a.revision=?))`,
        )
        .bind(
          `${key}:profiles`,
          site,
          pair.survivor.id,
          pair.survivor.revision,
          pair.survivor.affiliationRevision,
          pair.duplicate.id,
          pair.duplicate.revision,
          pair.duplicate.affiliationRevision,
        ),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${key}:profiles`),
    ]
  }
  async get(site: string, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_merges WHERE id=? AND site_id=? AND actor_id=?')
      .bind(id, site, this.actor)
      .first<MergeRequest>()
    if (!row) throw new SiteAccessError()
    const pair = await this.access.pair({
      site,
      survivor: row.survivor_id,
      duplicate: row.duplicate_id,
    })
    if (row.organization_id !== pair.scope.organization_id) throw new SiteAccessError()
    return { row, pair }
  }
  async create(input: MergePair & { expectedProfiles: Expected; operationKey: string }) {
    const pair = await this.access.pair(input)
    const intent = {
      survivor: input.survivor,
      duplicate: input.duplicate,
      expectedProfiles: input.expectedProfiles,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'merge.created',
      type: 'merge',
      intent,
    })
    if (replay) return replay
    this.expected(pair, input.expectedProfiles)
    const id = crypto.randomUUID(),
      now = new Date().toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: pair.scope.organization_id,
      authorityRevision: pair.scope.authorityRevision,
      action: 'merge.created',
      type: 'merge',
      id,
      after: intent,
      intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_merges(id,organization_id,site_id,actor_id,survivor_id,duplicate_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          pair.scope.organization_id,
          input.site,
          this.actor,
          input.survivor,
          input.duplicate,
          now,
          now,
        ),
      dependent: [
        ...this.guards(input.site, pair, input.operationKey),
        this.db
          .prepare(
            'INSERT INTO vc_crm_merge_events(id,merge_id,kind,actor_id,detail,created_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(crypto.randomUUID(), id, 'created', this.actor, JSON.stringify(intent), now),
      ],
      result: { id, revision: 1, state: 'draft' },
    })
  }
  async prepare(input: {
    site: string
    id: string
    expectedRevision: number
    expectedProfiles: Expected
    profileChoices: unknown
    operationKey: string
  }) {
    const { row, pair } = await this.get(input.site, input.id)
    const intent = {
      id: input.id,
      expectedRevision: input.expectedRevision,
      expectedProfiles: input.expectedProfiles,
      profileChoices: input.profileChoices,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'merge.review-prepared',
      type: 'merge',
      intent,
    })
    if (replay) return replay
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      row.revision !== input.expectedRevision ||
      !['draft', 'ready', 'failed', 'cancelled'].includes(row.state)
    )
      throw new SiteConflictError()
    this.expected(pair, input.expectedProfiles)
    const profile = prepareMergeProfile({
      survivor: {
        id: pair.survivor.id,
        organization: row.organization_id,
        revision: pair.survivor.revision,
        profile: pair.survivor.profile,
      },
      duplicate: {
        id: pair.duplicate.id,
        organization: row.organization_id,
        revision: pair.duplicate.revision,
        profile: pair.duplicate.profile,
      },
      choices: input.profileChoices,
    })
    const review = crypto.randomUUID(),
      job = crypto.randomUUID(),
      now = new Date().toISOString()
    const payload = JSON.stringify({ v: 1, phase: 'prepare', merge: row.id, review })
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: row.organization_id,
      authorityRevision: pair.scope.authorityRevision,
      action: 'merge.review-prepared',
      type: 'merge',
      id: row.id,
      after: { review, job, profile },
      intent,
      write: this.db
        .prepare(
          `INSERT INTO vc_crm_merge_reviews(id,merge_id,request_revision,authority_revision,survivor_revision,duplicate_revision,survivor_snapshot,duplicate_snapshot,decisions_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          review,
          row.id,
          row.revision,
          pair.scope.authorityRevision,
          pair.survivor.revision,
          pair.duplicate.revision,
          JSON.stringify(pair.survivor),
          JSON.stringify(pair.duplicate),
          JSON.stringify({ profile }),
          now,
        ),
      dependent: [
        ...this.guards(input.site, pair, input.operationKey),
        this.db
          .prepare(
            'INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(job, input.site, this.actor, 'contact-merge', payload, now, now, now),
        this.db
          .prepare(
            "UPDATE vc_crm_merges SET state='preparing',review_id=?,job_id=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND actor_id=? AND revision=? AND state IN('draft','ready','failed','cancelled')",
          )
          .bind(review, job, now, row.id, input.site, this.actor, input.expectedRevision),
        this.db
          .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
          .bind(`${input.operationKey}:request`),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:request`),
        this.db
          .prepare(
            'INSERT INTO vc_crm_merge_events(id,merge_id,kind,actor_id,detail,created_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            'review-prepared',
            this.actor,
            JSON.stringify({ review, job }),
            now,
          ),
      ],
      result: { id: row.id, review, job, revision: row.revision + 1, state: 'preparing' },
    })
  }
  async cancel(input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
  }) {
    const scope = await new OrganizationRepository(this.db, this.actor).require(
      input.site,
      'identity',
      'edit',
    )
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_merges WHERE id=? AND site_id=? AND actor_id=?')
      .bind(input.id, input.site, this.actor)
      .first<MergeRequest>()
    if (!row || row.organization_id !== scope.organization_id) throw new SiteAccessError()
    const intent = { id: input.id, expectedRevision: input.expectedRevision }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'merge.cancelled',
      type: 'merge',
      intent,
    })
    if (replay) return replay
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      row.revision !== input.expectedRevision ||
      ['completed', 'cancelled'].includes(row.state)
    )
      throw new SiteConflictError()
    if (
      await this.db
        .prepare('SELECT 1 FROM vc_crm_identity_aliases WHERE merge_id=? LIMIT 1')
        .bind(row.id)
        .first()
    )
      throw new SiteConflictError()
    const now = new Date().toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: row.organization_id,
      authorityRevision: scope.authorityRevision,
      action: 'merge.cancelled',
      type: 'merge',
      id: row.id,
      before: { state: row.state },
      after: { state: 'cancelled' },
      intent,
      write: this.db
        .prepare(
          "UPDATE vc_crm_merges SET state='cancelled',revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND actor_id=? AND revision=? AND state NOT IN('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM vc_crm_identity_aliases a WHERE a.merge_id=vc_crm_merges.id)",
        )
        .bind(now, row.id, input.site, this.actor, input.expectedRevision),
      dependent: [
        this.db
          .prepare(
            "UPDATE vc_crm_jobs SET status='cancelled',fence=fence+1,lease_until=NULL,updated_at=? WHERE id=? AND site_id=? AND actor_id=? AND kind='contact-merge' AND status IN('pending','running','failed')",
          )
          .bind(now, row.job_id, input.site, this.actor),
        this.db.prepare('DELETE FROM vc_crm_merge_locks WHERE merge_id=?').bind(row.id),
        this.db
          .prepare(
            'INSERT INTO vc_crm_merge_events(id,merge_id,kind,actor_id,detail,created_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            'cancelled',
            this.actor,
            JSON.stringify({ previousState: row.state }),
            now,
          ),
      ],
      result: { id: row.id, revision: row.revision + 1, state: 'cancelled' },
    })
  }
}
