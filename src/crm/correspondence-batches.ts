import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { CorrespondenceDocuments } from './correspondence-documents'
import { CRMJobs } from './jobs'
import { documentAmount } from './correspondence-giving'
import { commitCRM, replayCRM } from './mutations'
import {
  batchConfiguration,
  batchDocumentRequest,
  batchRecipient,
  batchText,
  recipientKey,
  type CorrespondenceBatchConfig,
} from './correspondence-batch-model'

export interface CorrespondenceBatchRow {
  id: string
  site_id: string
  actor_id: number
  name: string
  config: string
  config_revision: number
  status: 'draft' | 'approved'
  revision: number
  financial: number
  membership: number
  job_id: string | null
  approved_authority_revision: number | null
  created_at: string
  updated_at: string
}
export interface CorrespondenceRecipientRow {
  id: string
  batch_id: string
  site_id: string
  constituent_id: string
  source_key: string
  recipient: string
  request: string
  preview: string
  approval: string
  config_revision: number
  revision: number
  validated_revision: number | null
  removed: number
  document_id: string | null
}
type Mutation = { site: string; id: string; expectedRevision: number; operationKey: string }
type RecipientSource = {
  gift_snapshot: string | null
  membership_snapshot: string | null
  statement_year: number | null
}
function sourceSummary(row: RecipientSource) {
  if (row.gift_snapshot) {
    const gift = JSON.parse(row.gift_snapshot) as {
      id: string
      received_on: string
      kind: string
      state: string
      net_minor: string
      currency: string
      exponent: number
    }
    return `Reviewed gift on ${gift.received_on} · ${gift.kind} · ${gift.state} · ${gift.kind === 'in-kind' ? 'No cash valuation' : documentAmount(gift.net_minor, gift.currency, gift.exponent)} · Record ${gift.id}`
  }
  if (row.membership_snapshot) {
    const term = JSON.parse(row.membership_snapshot) as {
      id: string
      type_name: string
      ends_on: string
    }
    return `${term.type_name} · Term ends ${term.ends_on} · Record ${term.id}`
  }
  return row.statement_year ? `Statement year ${row.statement_year}` : 'Contact correspondence'
}
const visibleRecipients = `NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients r
  LEFT JOIN vc_crm_constituents c ON c.id=r.constituent_id AND c.archived=0
  LEFT JOIN vc_crm_affiliations a ON a.constituent_id=r.constituent_id AND a.site_id=b.site_id AND a.archived=0
  WHERE r.batch_id=b.id AND r.removed=0 AND (c.id IS NULL OR a.id IS NULL))`

/** Staff-owned batches retain issued history and never transmit email as a side effect. */
export class CorrespondenceBatches {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  async scope(siteID: string, id: string, operation: 'read' | 'edit' = 'read') {
    const site = await this.authority.require(siteID, 'communications', operation)
    if (operation === 'edit') await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const batch = await this.db
      .prepare(
        `SELECT b.* FROM vc_crm_correspondence_batches b WHERE b.id=? AND b.site_id=? ${operation === 'edit' ? 'AND b.actor_id=?' : ''} AND ${visibleRecipients}`,
      )
      .bind(id, siteID, ...(operation === 'edit' ? [this.actor] : []))
      .first<CorrespondenceBatchRow>()
    if (!batch) throw new SiteAccessError()
    if (batch.financial) await this.authority.require(siteID, 'finances', 'read')
    if (batch.membership) await this.authority.require(siteID, 'memberships', 'read')
    const current = await this.authority.require(siteID, 'communications', operation)
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { site, batch }
  }
  private revision(batch: CorrespondenceBatchRow, expected: number) {
    if (!Number.isSafeInteger(expected) || expected !== batch.revision)
      throw new SiteConflictError()
  }
  private async configuration(site: string, values: Record<string, unknown>) {
    const row = await this.db
      .prepare('SELECT kind FROM vc_crm_templates WHERE id=? AND site_id=? AND archived=0')
      .bind(String(values.template || ''), site)
      .first<{ kind: string }>()
    if (!row) throw new Error('Choose an active correspondence template in this chapter.')
    const config = batchConfiguration(values, row.kind)
    if (config.source === 'gifts' || config.kind === 'annual-statement')
      await this.authority.require(site, 'finances', 'read')
    if (config.source === 'memberships') await this.authority.require(site, 'memberships', 'read')
    return config
  }
  async list(siteID: string, after = '') {
    const site = await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const financial = (await this.authority.authority(siteID, 'finances', 'read')).allowed,
      membership = (await this.authority.authority(siteID, 'memberships', 'read')).allowed
    const rows = (
      await this.db
        .prepare(
          `SELECT b.id,b.name,b.status,b.revision,b.created_at FROM vc_crm_correspondence_batches b
      WHERE b.site_id=? AND b.id>? AND (b.financial=0 OR ?=1) AND (b.membership=0 OR ?=1)
      AND ${visibleRecipients} ORDER BY b.id LIMIT 51`,
        )
        .bind(siteID, after, financial ? 1 : 0, membership ? 1 : 0)
        .all<{ id: string; name: string; status: string; revision: number; created_at: string }>()
    ).results
    const editable = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    if (rows.length) {
      const current = await this.db
        .prepare(
          `SELECT count(*) AS total FROM vc_crm_correspondence_batches b
        WHERE b.id IN(SELECT value FROM json_each(?)) AND b.site_id=? AND ${visibleRecipients}`,
        )
        .bind(JSON.stringify(rows.map((row) => row.id)), siteID)
        .first<number>('total')
      if (current !== rows.length) throw new SiteAccessError()
    }
    if (
      (await this.authority.require(siteID, 'communications', 'read')).authorityRevision !==
      site.authorityRevision
    )
      throw new SiteAccessError()
    return {
      docs: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].id : null,
      canEdit: editable,
    }
  }
  async get(siteID: string, id: string, after = '') {
    const context = await this.scope(siteID, id)
    const items = (
      await this.db
        .prepare(
          `SELECT r.id,r.revision,r.recipient,r.config_revision,r.document_id,
      json_extract(r.preview,'$.recipient.name') AS label,json_extract(r.preview,'$.subject') AS subject,
      json_extract(r.preview,'$.authorityRevision') AS authority_revision,
      json_extract(r.preview,'$.gift') AS gift_snapshot,json_extract(r.preview,'$.membership') AS membership_snapshot,json_extract(r.preview,'$.year') AS statement_year,
      EXISTS(SELECT 1 FROM vc_crm_document_files f WHERE f.document_id=r.document_id) AS pdf_ready
      FROM vc_crm_correspondence_recipients r WHERE r.batch_id=? AND r.removed=0 AND r.id>? ORDER BY r.id LIMIT 51`,
        )
        .bind(id, after)
        .all<
          Pick<
            CorrespondenceRecipientRow,
            'id' | 'revision' | 'recipient' | 'config_revision' | 'document_id'
          > &
            RecipientSource & {
              label: string
              subject: string
              authority_revision: number
              pdf_ready: number
            }
        >()
    ).results
    const totals = await this.db
      .prepare(
        `SELECT count(*) AS total,coalesce(sum(document_id IS NOT NULL),0) AS issued,
      coalesce(sum(document_id IS NULL AND (config_revision<>? OR json_extract(preview,'$.authorityRevision')<>?)),0) AS stale
      FROM vc_crm_correspondence_recipients WHERE batch_id=? AND removed=0`,
      )
      .bind(context.batch.config_revision, context.site.authorityRevision, id)
      .first<{ total: number; issued: number; stale: number }>()
    const job = context.batch.job_id
      ? await this.db
          .prepare(
            'SELECT id,status,fence,progress,attempts,error FROM vc_crm_jobs WHERE id=? AND actor_id=? AND site_id=?',
          )
          .bind(context.batch.job_id, context.batch.actor_id, siteID)
          .first<{
            id: string
            status: string
            fence: number
            progress: number
            attempts: number
            error: string | null
          }>()
      : null
    const template = await this.db
      .prepare('SELECT name,archived FROM vc_crm_templates WHERE id=? AND site_id=?')
      .bind((JSON.parse(context.batch.config) as CorrespondenceBatchConfig).template, siteID)
      .first<{ name: string; archived: number }>()
    const canEdit =
      context.batch.actor_id === this.actor &&
      (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    const current = await this.scope(siteID, id)
    if (current.site.authorityRevision !== context.site.authorityRevision)
      throw new SiteAccessError()
    if (current.batch.revision !== context.batch.revision) throw new SiteConflictError()
    return {
      doc: {
        ...context.batch,
        config: JSON.parse(context.batch.config) as CorrespondenceBatchConfig,
        templateName: template?.name || 'Template unavailable',
        templateArchived: !template || !!template.archived,
      },
      items: items.slice(0, 50).map((row) => ({
        id: row.id,
        revision: row.revision,
        recipient: JSON.parse(row.recipient),
        label: row.label,
        subject: row.subject,
        source: sourceSummary(row),
        stale:
          row.config_revision !== context.batch.config_revision ||
          row.authority_revision !== context.site.authorityRevision,
        document: row.document_id,
        pdfReady: !!row.pdf_ready,
      })),
      next: items.length > 50 ? items[49].id : null,
      totals: totals!,
      job,
      canEdit,
    }
  }
  async preview(siteID: string, id: string, recipient: string) {
    const before = await this.scope(siteID, id)
    const row = await this.db
      .prepare(
        'SELECT preview,document_id FROM vc_crm_correspondence_recipients WHERE id=? AND batch_id=? AND removed=0',
      )
      .bind(recipient, id)
      .first<{ preview: string; document_id: string | null }>()
    if (!row) throw new SiteAccessError()
    const snapshot = row.document_id
      ? (await new CorrespondenceDocuments(this.db, this.actor).get(siteID, row.document_id))
          .snapshot
      : row.preview
    const current = await this.scope(siteID, id)
    if (current.site.authorityRevision !== before.site.authorityRevision)
      throw new SiteAccessError()
    if (current.batch.revision !== before.batch.revision) throw new SiteConflictError()
    return {
      snapshot: JSON.parse(snapshot) as Awaited<
        ReturnType<CorrespondenceDocuments['preview']>
      >['snapshot'],
      document: row.document_id,
    }
  }
  /** Optional foreground acceleration uses the same leases as the scheduled runner, scoped to this owner's batch. */
  async process(siteID: string, id: string, storage: R2Bucket) {
    const context = await this.scope(siteID, id, 'edit'),
      now = new Date().toISOString()
    const candidate = await this.db
      .prepare(
        `SELECT j.id FROM vc_crm_jobs j WHERE j.site_id=? AND j.actor_id=? AND j.kind='correspondence'
      AND j.next_attempt_at<=? AND (j.status='pending' OR (j.status='running' AND j.lease_until<=?))
      AND (j.id=? OR EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients r WHERE r.batch_id=? AND r.removed=0
        AND r.document_id=json_extract(j.payload,'$.document'))) ORDER BY j.next_attempt_at,j.id LIMIT 1`,
      )
      .bind(siteID, this.actor, now, now, context.batch.job_id, id)
      .first<{ id: string }>()
    if (!candidate) return { worked: false }
    const { correspondenceJob } = await import('./correspondence-job')
    const worked = await new CRMJobs(this.db).tick(
      { correspondence: correspondenceJob(this.db, storage) },
      candidate.id,
    )
    if (
      (await this.scope(siteID, id, 'edit')).site.authorityRevision !==
      context.site.authorityRevision
    )
      throw new SiteAccessError()
    return { worked }
  }
  async save(input: {
    site: string
    id?: string
    expectedRevision?: number
    operationKey: string
    name: string
    values: Record<string, unknown>
  }) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'communications', 'read')
    await this.authority.require(input.site, 'identity', 'read')
    const name = batchText(input.name, 180, true),
      config = await this.configuration(input.site, input.values)
    const intent = {
        id: input.id || null,
        expectedRevision: input.expectedRevision ?? null,
        name,
        values: input.values,
      },
      action = input.id ? 'correspondence.batch.updated' : 'correspondence.batch.created'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'correspondence-batch',
      intent,
    })
    if (replay) {
      await this.scope(input.site, String(replay.id))
      return replay
    }
    const prior = input.id ? (await this.scope(input.site, input.id, 'edit')).batch : null
    if (prior) {
      this.revision(prior, input.expectedRevision!)
      if (prior.status !== 'draft') throw new SiteConflictError()
      const old = JSON.parse(prior.config) as CorrespondenceBatchConfig
      if (
        old.source !== config.source &&
        (await this.db
          .prepare(
            'SELECT id FROM vc_crm_correspondence_recipients WHERE batch_id=? AND removed=0 LIMIT 1',
          )
          .bind(prior.id)
          .first())
      )
        throw new Error('Remove draft recipients before changing their source.')
    }
    const id = prior?.id || crypto.randomUUID(),
      now = new Date().toISOString(),
      financial = config.source === 'gifts' || config.kind === 'annual-statement' ? 1 : 0,
      membership = config.source === 'memberships' ? 1 : 0
    const write = prior
      ? this.db
          .prepare(
            `UPDATE vc_crm_correspondence_batches SET name=?,config_revision=config_revision+CASE WHEN config<>? THEN 1 ELSE 0 END,config=?,
      financial=max(financial,?),membership=max(membership,?),revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft'`,
          )
          .bind(
            name,
            JSON.stringify(config),
            JSON.stringify(config),
            financial,
            membership,
            now,
            id,
            prior.revision,
          )
      : this.db
          .prepare(
            'INSERT INTO vc_crm_correspondence_batches(id,site_id,actor_id,name,config,financial,membership,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            id,
            input.site,
            this.actor,
            name,
            JSON.stringify(config),
            financial,
            membership,
            now,
            now,
          )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'correspondence-batch',
      id,
      intent,
      after: { name, config },
      write,
      result: { id, revision: (prior?.revision || 0) + 1 },
    })
  }
  async prepareRecipient(input: Mutation & { recipient: Record<string, unknown> }) {
    const { site, batch } = await this.scope(input.site, input.id, 'edit')
    const config = JSON.parse(batch.config) as CorrespondenceBatchConfig,
      recipient = batchRecipient(input.recipient, config.source),
      sourceKey = recipientKey(recipient),
      intent = { id: input.id, expectedRevision: input.expectedRevision, recipient }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'correspondence.recipient.reviewed',
      type: 'correspondence-batch',
      intent,
    })
    if (replay) return replay
    this.revision(batch, input.expectedRevision)
    if (batch.status !== 'draft') throw new SiteConflictError()
    const request = batchDocumentRequest(input.site, config, recipient),
      reviewed = await new CorrespondenceDocuments(this.db, this.actor).preview(request)
    if (reviewed.snapshot.authorityRevision !== site.authorityRevision)
      throw new SiteConflictError()
    const existing = await this.db
      .prepare(
        'SELECT id,revision,document_id FROM vc_crm_correspondence_recipients WHERE batch_id=? AND source_key=?',
      )
      .bind(batch.id, sourceKey)
      .first<{ id: string; revision: number; document_id: string | null }>()
    if (existing?.document_id)
      throw new Error('This recipient already has an issued document in this batch.')
    const id = existing?.id || crypto.randomUUID(),
      now = new Date().toISOString()
    const item = existing
      ? this.db
          .prepare(
            `UPDATE vc_crm_correspondence_recipients SET recipient=?,request=?,preview=?,approval=?,config_revision=?,
      revision=revision+1,validated_revision=NULL,removed=0,updated_at=? WHERE id=? AND revision=? AND document_id IS NULL`,
          )
          .bind(
            JSON.stringify(recipient),
            JSON.stringify(request),
            JSON.stringify(reviewed.snapshot),
            reviewed.approval,
            batch.config_revision,
            now,
            id,
            existing.revision,
          )
      : this.db
          .prepare(
            `INSERT INTO vc_crm_correspondence_recipients(id,batch_id,site_id,constituent_id,source_key,recipient,request,preview,approval,config_revision,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            batch.id,
            input.site,
            recipient.contact,
            sourceKey,
            JSON.stringify(recipient),
            JSON.stringify(request),
            JSON.stringify(reviewed.snapshot),
            reviewed.approval,
            batch.config_revision,
            now,
            now,
          )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'correspondence.recipient.reviewed',
      type: 'correspondence-batch',
      id: batch.id,
      intent,
      after: { recipient: id, constituent: recipient.contact, approval: reviewed.approval },
      write: this.db
        .prepare(
          "UPDATE vc_crm_correspondence_batches SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft'",
        )
        .bind(now, batch.id, batch.revision),
      dependent: [
        item,
        ...this.changed(input.operationKey + '_item'),
        this.db
          .prepare(
            `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_constituents c
          JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.revision=? AND a.archived=0
          WHERE c.id=? AND c.revision=? AND c.archived=0`,
          )
          .bind(
            input.operationKey + '_recipient',
            input.site,
            reviewed.snapshot.affiliationRevision,
            recipient.contact,
            reviewed.snapshot.contactRevision,
          ),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(input.operationKey + '_recipient'),
      ],
      result: { id: batch.id, recipient: id, revision: batch.revision + 1 },
    })
  }
  private changed(key: string) {
    return [
      this.db
        .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
        .bind(key),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
    ]
  }
  async remove(input: Mutation & { recipient: string }) {
    const { site, batch } = await this.scope(input.site, input.id, 'edit'),
      intent = {
        id: input.id,
        recipient: input.recipient,
        expectedRevision: input.expectedRevision,
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'correspondence.recipient.removed',
      type: 'correspondence-batch',
      intent,
    })
    if (replay) return replay
    this.revision(batch, input.expectedRevision)
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'correspondence.recipient.removed',
      type: 'correspondence-batch',
      id: batch.id,
      intent,
      after: { recipient: input.recipient, removed: true },
      write: this.db
        .prepare(
          "UPDATE vc_crm_correspondence_batches SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft'",
        )
        .bind(new Date().toISOString(), batch.id, batch.revision),
      dependent: [
        this.db
          .prepare(
            'UPDATE vc_crm_correspondence_recipients SET removed=1,revision=revision+1 WHERE id=? AND batch_id=? AND removed=0 AND document_id IS NULL',
          )
          .bind(input.recipient, batch.id),
        ...this.changed(input.operationKey + '_item'),
      ],
      result: { id: batch.id, revision: batch.revision + 1 },
    })
  }
  async approve(input: Mutation) {
    const { site, batch } = await this.scope(input.site, input.id, 'edit'),
      intent = { id: input.id, expectedRevision: input.expectedRevision }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'correspondence.batch.approved',
      type: 'correspondence-batch',
      intent,
    })
    if (replay) return replay
    this.revision(batch, input.expectedRevision)
    if (batch.status !== 'draft') throw new SiteConflictError()
    const job = crypto.randomUUID(),
      now = new Date().toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'correspondence.batch.approved',
      type: 'correspondence-batch',
      id: batch.id,
      intent,
      after: { job, approvedRevision: batch.revision + 1 },
      write: this.db
        .prepare(
          "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'correspondence',?,?,?,?)",
        )
        .bind(
          job,
          input.site,
          this.actor,
          JSON.stringify({ batch: batch.id, revision: batch.revision + 1 }),
          now,
          now,
          now,
        ),
      dependent: [
        this.db
          .prepare(
            `UPDATE vc_crm_correspondence_batches SET status='approved',revision=revision+1,job_id=?,approved_authority_revision=?,updated_at=?
        WHERE id=? AND revision=? AND status='draft'
        AND EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients r WHERE r.batch_id=? AND r.removed=0 AND r.document_id IS NULL)
        AND NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients r WHERE r.batch_id=? AND r.removed=0 AND r.document_id IS NULL
          AND (r.config_revision<>vc_crm_correspondence_batches.config_revision OR json_extract(r.preview,'$.authorityRevision')<>?))`,
          )
          .bind(
            job,
            site.authorityRevision,
            now,
            batch.id,
            batch.revision,
            batch.id,
            batch.id,
            site.authorityRevision,
          ),
        ...this.changed(input.operationKey + '_batch'),
      ],
      result: { id: batch.id, job, revision: batch.revision + 1 },
    })
  }
  async reopen(input: Mutation) {
    const { site, batch } = await this.scope(input.site, input.id, 'edit'),
      intent = { id: input.id, expectedRevision: input.expectedRevision }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'correspondence.batch.reopened',
      type: 'correspondence-batch',
      intent,
    })
    if (replay) return replay
    this.revision(batch, input.expectedRevision)
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'correspondence.batch.reopened',
      type: 'correspondence-batch',
      id: batch.id,
      intent,
      after: { status: 'draft' },
      write: this.db
        .prepare(
          `UPDATE vc_crm_correspondence_batches SET status='draft',revision=revision+1,job_id=NULL,approved_authority_revision=NULL,updated_at=?
        WHERE id=? AND revision=? AND status='approved' AND EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_correspondence_batches.job_id AND j.status IN('completed','failed','cancelled'))`,
        )
        .bind(new Date().toISOString(), batch.id, batch.revision),
      result: { id: batch.id, revision: batch.revision + 1 },
    })
  }
  async control(input: {
    site: string
    id: string
    job: string
    expectedFence: number
    action: 'retry' | 'cancel'
    operationKey: string
  }) {
    const { batch } = await this.scope(input.site, input.id, 'edit')
    if (batch.job_id !== input.job) throw new SiteConflictError()
    const jobs = new CRMJobs(this.db)
    return input.action === 'retry'
      ? jobs.retry(this.actor, input.site, input.job, input.expectedFence, input.operationKey, true)
      : jobs.cancel(this.actor, input.site, input.job, input.operationKey, input.expectedFence)
  }
}
