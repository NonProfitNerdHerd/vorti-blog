import { MergeAccess } from './merge-access'
import { mergeReferenceRules, type MergeReferenceKind } from './merge-references'
import { CRMJobPermanentError, type CRMJobHandler } from './jobs'

const kinds = Object.keys(mergeReferenceRules) as MergeReferenceKind[]
type Review = {
  authority_revision: number
  survivor_revision: number
  duplicate_revision: number
  survivor_snapshot: string
  duplicate_snapshot: string
}

/** Internal relational inventory stage. Deliberately does not seal a review or
 * make it approvable: soft references and native Task preservation must also be
 * scanned before the final approval manifest can be published. */
export function mergeScanJob(db: D1Database): CRMJobHandler {
  return {
    async prepare(job) {
      let payload: { v?: unknown; phase?: unknown; merge?: unknown; review?: unknown }
      let cursor: { kind: number; after?: string }
      try {
        payload = JSON.parse(job.payload)
        cursor = job.cursor ? JSON.parse(job.cursor) : { kind: 0 }
        if (!payload || !cursor) throw new Error()
      } catch {
        throw new CRMJobPermanentError('invalid-request')
      }
      if (
        job.kind !== 'contact-merge' ||
        payload.v !== 1 ||
        payload.phase !== 'prepare' ||
        typeof payload.merge !== 'string' ||
        typeof payload.review !== 'string' ||
        !Number.isSafeInteger(cursor.kind) ||
        cursor.kind < 0 ||
        cursor.kind >= kinds.length ||
        (cursor.after !== undefined &&
          (typeof cursor.after !== 'string' || cursor.after.length > 2048))
      )
        throw new CRMJobPermanentError('invalid-request')
      const request = await db
        .prepare(
          `SELECT organization_id,survivor_id,duplicate_id,revision FROM vc_crm_merges
          WHERE id=? AND site_id=? AND actor_id=? AND review_id=? AND job_id=? AND state='preparing'`,
        )
        .bind(payload.merge, job.site_id, job.actor_id, payload.review, job.id)
        .first<{
          organization_id: string
          survivor_id: string
          duplicate_id: string
          revision: number
        }>()
      const review = await db
        .prepare('SELECT * FROM vc_crm_merge_reviews WHERE id=? AND merge_id=?')
        .bind(payload.review, payload.merge)
        .first<Review>()
      if (!request || !review) throw new CRMJobPermanentError('stale-review')
      const access = new MergeAccess(db, job.actor_id)
      const context = {
        site: job.site_id,
        survivor: request.survivor_id,
        duplicate: request.duplicate_id,
      }
      const kind = kinds[cursor.kind]
      const page = await access.inventoryPage({ ...context, kind, after: cursor.after })
      const survivorSnapshot = JSON.parse(review.survivor_snapshot) as {
        affiliationRevision: number
      }
      const duplicateSnapshot = JSON.parse(review.duplicate_snapshot) as {
        affiliationRevision: number
      }
      const pair = await access.pair(context)
      if (
        page.authorityRevision !== review.authority_revision ||
        page.expectedRevisions.survivor !== review.survivor_revision ||
        page.expectedRevisions.duplicate !== review.duplicate_revision ||
        pair.survivor.affiliationRevision !== survivorSnapshot.affiliationRevision ||
        pair.duplicate.affiliationRevision !== duplicateSnapshot.affiliationRevision
      )
        throw new CRMJobPermanentError('stale-review')
      const key = crypto.randomUUID()
      const writes: D1PreparedStatement[] = []
      const guard = (suffix: string, sql: string, values: (string | number)[]) => {
        writes.push(
          db
            .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
            .bind(key + suffix, ...values),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + suffix),
        )
      }
      guard(
        ':request',
        `SELECT ?,count(*) FROM vc_crm_merges WHERE id=? AND revision=? AND review_id=? AND job_id=? AND state='preparing'`,
        [payload.merge, request.revision, payload.review, job.id],
      )
      guard(
        ':authority',
        'SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        [request.organization_id, review.authority_revision],
      )
      for (const [identity, revision] of [
        [request.survivor_id, review.survivor_revision],
        [request.duplicate_id, review.duplicate_revision],
      ] as const)
        guard(
          ':' + identity,
          'SELECT ?,count(*) FROM vc_crm_constituents WHERE id=? AND organization_id=? AND revision=?',
          [identity, request.organization_id, revision],
        )
      for (const [identity, revision] of [
        [request.survivor_id, survivorSnapshot.affiliationRevision],
        [request.duplicate_id, duplicateSnapshot.affiliationRevision],
      ] as const)
        guard(
          ':affiliation:' + identity,
          'SELECT ?,count(*) FROM vc_crm_affiliations WHERE constituent_id=? AND site_id=? AND revision=? AND archived=0',
          [identity, job.site_id, revision],
        )
      for (const row of page.docs) {
        const snapshot = JSON.stringify(row)
        const fingerprint = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
        writes.push(
          db
            .prepare(
              `INSERT INTO vc_crm_merge_items(review_id,kind,cursor_key,site_id,record_id,fingerprint,snapshot)
              VALUES(?,?,?,?,?,?,?)`,
            )
            .bind(
              payload.review,
              kind,
              row.mergeKey,
              row.mergeSite,
              row.mergeKey,
              fingerprint,
              snapshot,
            ),
        )
      }
      const done = !page.next && cursor.kind === kinds.length - 1
      return {
        writes,
        cursor: JSON.stringify(
          page.next ? { kind: cursor.kind, after: page.next } : { kind: cursor.kind + 1 },
        ),
        processed: page.docs.length,
        done,
        ...(done
          ? {
              result: {
                merge: payload.merge,
                review: payload.review,
                stage: 'relational-inventory',
                approvable: false,
              },
            }
          : {}),
      }
    },
  }
}
