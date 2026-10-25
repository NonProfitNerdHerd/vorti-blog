import { SiteConflictError } from '../organizations/atomic'
import { SiteAccessError } from '../organizations/repository'
import { scopeImportRun } from './import-access'
import { authorizedImportReview } from './import-review-access'
import { importCSVLine } from './import-result-csv'
import type { ImportRow } from './import-types'

/** Bounded-memory, complete source/result traversal. Cached resolved CRM values
 * are not exported; current access is checked before disclosing review issues.
 * Interrupted/changed/denied reads error the stream rather than silently ending. */
export async function importResultsCSV(
  db: D1Database,
  actor: number,
  siteID: string,
  id: string,
  errorsOnly = false,
) {
  const initial = await scopeImportRun(db, actor, siteID, id)
  if (initial.run.stage_state !== 'review')
    throw Error('Prepare source rows before downloading results.')
  const check = async () => {
    const current = await scopeImportRun(db, actor, siteID, id)
    if (current.site.authorityRevision !== initial.site.authorityRevision)
      throw new SiteAccessError()
    if (
      current.run.revision !== initial.run.revision ||
      current.run.updated_at !== initial.run.updated_at
    )
      throw new SiteConflictError()
    const active = await db
      .prepare(
        "SELECT count(*) AS n FROM vc_crm_jobs WHERE id=? AND status IN('pending','running')",
      )
      .bind(current.run.job_id)
      .first<{ n: number }>()
    if (active?.n) throw Error('Wait for import processing to stop before downloading results.')
  }
  await check()
  const condition = errorsOnly
    ? " AND (json_array_length(parse_issues)>0 OR coalesce(json_array_length(review_json,'$.issues'),0)>0)"
    : ''
  const size = await db
    .prepare(
      'SELECT count(*) AS n,coalesce(max(json_array_length(data_json)),0) AS columns FROM vc_crm_import_rows WHERE run_id=?' +
        condition,
    )
    .bind(id)
    .first<{ n: number; columns: number }>()
  if (!size) throw Error('Unable to count import results.')
  const sourceHeaders = JSON.parse(initial.run.headers_json) as string[],
    width = Math.max(sourceHeaders.length, size.columns),
    encoder = new TextEncoder()
  let after = 0,
    visited = 0,
    header = false,
    cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await check()
        if (cancelled) return
        if (!header) {
          header = true
          controller.enqueue(
            encoder.encode(
              '\ufeff' +
                importCSVLine([
                  'Source row',
                  'Saved decision',
                  'Review state',
                  'Applied result',
                  'Applied at',
                  'Issues',
                  ...Array.from(
                    { length: width },
                    (_, index) => `${index + 1}. ${sourceHeaders[index] || '(no header)'}`,
                  ),
                ]),
            ),
          )
          return
        }
        // One complete row per pull bounds memory even for large source cells.
        const row = await db
          .prepare(
            'SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number>?' +
              condition +
              ' ORDER BY number LIMIT 1',
          )
          .bind(id, after)
          .first<ImportRow>()
        if (!row) {
          if (visited !== size.n) throw new SiteConflictError()
          await check()
          if (!cancelled) controller.close()
          return
        }
        const issues = (
          JSON.parse(row.parse_issues) as Array<{ column: number; message: string }>
        ).map((issue) => `Column ${issue.column + 1}: ${issue.message}`)
        let reviewState = 'Not reviewed'
        if (row.review_hash) {
          const review = await authorizedImportReview(db, actor, siteID, id, row)
          reviewState =
            row.review_config_revision === initial.run.config_revision &&
            row.review_authority_revision === initial.site.authorityRevision
              ? 'Current'
              : 'Needs review'
          issues.push(
            ...review.issues.map(
              (issue) => `${issue.field ? issue.field + ': ' : ''}${issue.message}`,
            ),
          )
        }
        await check()
        if (cancelled) return
        visited++
        after = row.number
        const values = JSON.parse(row.data_json) as string[]
        controller.enqueue(
          encoder.encode(
            importCSVLine([
              row.number,
              row.decision,
              reviewState,
              row.applied_action,
              row.applied_at,
              issues.join('\n'),
              ...Array.from({ length: width }, (_, index) => values[index] ?? ''),
            ]),
          ),
        )
      } catch (cause) {
        if (!cancelled) controller.error(cause)
      }
    },
    cancel() {
      cancelled = true
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${errorsOnly ? 'errors' : 'results'}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Import-Matching-Rows': String(size.n),
    },
  })
}
