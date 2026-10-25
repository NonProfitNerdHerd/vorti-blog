import { SiteConflictError } from '../organizations/atomic'
import { CorrespondenceBatches, type CorrespondenceRecipientRow } from './correspondence-batches'
import { CorrespondenceDocuments } from './correspondence-documents'
import type { DocumentRequest } from './correspondence-snapshot'
import {
  batchDocumentRequest,
  batchRecipient,
  type CorrespondenceBatchConfig,
} from './correspondence-batch-model'
import { prepareCRMCheckpoint } from './mutations'
import { CRMJobPermanentError, type CRMJobHandler } from './jobs'

/** Complete validation precedes the first issuance. Every document and cursor commit together. */
export function correspondenceBatchJob(db: D1Database): CRMJobHandler {
  return {
    async prepare(job) {
      const payload = JSON.parse(job.payload) as { batch?: unknown; revision?: unknown }
      if (typeof payload.batch !== 'string' || !Number.isSafeInteger(payload.revision))
        throw new CRMJobPermanentError('invalid-request')
      const { batch, site } = await new CorrespondenceBatches(db, job.actor_id).scope(
        job.site_id,
        payload.batch,
        'edit',
      )
      if (
        batch.job_id !== job.id ||
        batch.status !== 'approved' ||
        batch.revision !== payload.revision ||
        batch.approved_authority_revision !== site.authorityRevision
      )
        throw new CRMJobPermanentError('stale-review')
      const cursor = job.cursor
        ? (JSON.parse(job.cursor) as { phase: string; after: string })
        : { phase: 'validate', after: '' }
      if (
        !['validate', 'issue'].includes(cursor.phase) ||
        typeof cursor.after !== 'string' ||
        cursor.after.length > 128
      )
        throw new CRMJobPermanentError('invalid-request')
      const guardKey = crypto.randomUUID()
      const checked = (suffix: string, select: string, values: (string | number)[]) => [
        db
          .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${select}`)
          .bind(`${guardKey}_${suffix}`, ...values),
        db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${guardKey}_${suffix}`),
      ]
      const writes = checked(
        'batch',
        `SELECT ?,count(*) FROM vc_crm_correspondence_batches WHERE id=? AND site_id=? AND actor_id=?
      AND status='approved' AND revision=? AND job_id=? AND approved_authority_revision=?`,
        [batch.id, job.site_id, job.actor_id, batch.revision, job.id, site.authorityRevision],
      )
      const row = await db
        .prepare(
          `SELECT * FROM vc_crm_correspondence_recipients WHERE batch_id=? AND removed=0 AND document_id IS NULL AND id>? ORDER BY id LIMIT 1`,
        )
        .bind(batch.id, cursor.after)
        .first<CorrespondenceRecipientRow>()
      if (!row) {
        if (cursor.phase === 'validate') {
          writes.push(
            ...checked(
              'validated',
              `SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients WHERE batch_id=?
          AND removed=0 AND document_id IS NULL AND coalesce(validated_revision,-1)<>?) THEN 1 ELSE 0 END`,
              [batch.id, batch.revision],
            ),
          )
          return {
            writes,
            cursor: JSON.stringify({ phase: 'issue', after: '' }),
            processed: 0,
            done: false,
          }
        }
        writes.push(
          ...checked(
            'complete',
            `SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_recipients WHERE batch_id=?
        AND removed=0 AND document_id IS NULL) THEN 1 ELSE 0 END`,
            [batch.id],
          ),
        )
        const count = await db
          .prepare(
            'SELECT count(*) AS total FROM vc_crm_correspondence_recipients WHERE batch_id=? AND removed=0 AND document_id IS NOT NULL',
          )
          .bind(batch.id)
          .first<number>('total')
        return {
          writes,
          cursor: JSON.stringify(cursor),
          processed: 0,
          done: true,
          result: { batch: batch.id, documents: count || 0 },
        }
      }
      if (row.site_id !== job.site_id || row.config_revision !== batch.config_revision)
        throw new CRMJobPermanentError('stale-review')
      const config = JSON.parse(batch.config) as CorrespondenceBatchConfig,
        recipient = batchRecipient(JSON.parse(row.recipient), config.source),
        expected = batchDocumentRequest(job.site_id, config, recipient),
        request = JSON.parse(row.request) as DocumentRequest
      if (
        JSON.stringify(request) !== JSON.stringify(expected) ||
        request.contact !== row.constituent_id
      )
        throw new CRMJobPermanentError('invalid-request')
      const documents = new CorrespondenceDocuments(db, job.actor_id),
        now = new Date().toISOString()
      try {
        if (cursor.phase === 'validate') {
          const preview = await documents.preview(request)
          if (
            preview.approval !== row.approval ||
            preview.snapshot.authorityRevision !== site.authorityRevision
          )
            throw new CRMJobPermanentError('stale-review')
          writes.push(
            db
              .prepare(
                'UPDATE vc_crm_correspondence_recipients SET validated_revision=?,updated_at=? WHERE id=? AND revision=? AND document_id IS NULL AND removed=0',
              )
              .bind(batch.revision, now, row.id, row.revision),
            ...checked('item', 'VALUES(?,changes())', []),
          )
        } else {
          if (row.validated_revision !== batch.revision)
            throw new CRMJobPermanentError('stale-review')
          const mutation = await documents.prepareIssue({
            ...request,
            approval: row.approval,
            operationKey: crypto.randomUUID(),
          })
          writes.push(
            ...(await prepareCRMCheckpoint(mutation)),
            db
              .prepare(
                'UPDATE vc_crm_correspondence_recipients SET document_id=?,updated_at=? WHERE id=? AND revision=? AND document_id IS NULL AND removed=0 AND validated_revision=?',
              )
              .bind(String(mutation.result.id), now, row.id, row.revision, batch.revision),
            ...checked('item', 'VALUES(?,changes())', []),
          )
        }
      } catch (error) {
        if (error instanceof SiteConflictError) throw new CRMJobPermanentError('stale-review')
        throw error
      }
      return {
        writes,
        cursor: JSON.stringify({ phase: cursor.phase, after: row.id }),
        processed: 1,
        done: false,
      }
    },
  }
}
