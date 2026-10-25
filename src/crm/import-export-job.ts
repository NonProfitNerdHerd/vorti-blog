import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { scopeImportExport } from './import-exports'
import { importResultCondition, importResultHeader, importResultLine } from './import-result-format'
import type { ImportRow } from './import-types'
import { importAssemblyCursor, prepareImportAssembly } from './import-export-assembly'

export const importExportMismatch = `NOT EXISTS(SELECT 1 FROM vc_crm_import_export_chunks c,json_each(c.snapshots) s LEFT JOIN vc_crm_import_rows r ON r.run_id=? AND r.number=json_extract(s.value,'$.number') WHERE c.export_id=? AND(r.number IS NULL OR r.revision<>json_extract(s.value,'$.revision') OR r.review_hash IS NOT json_extract(s.value,'$.hash') OR r.applied_at IS NOT json_extract(s.value,'$.appliedAt') OR r.applied_action IS NOT json_extract(s.value,'$.appliedAction')))`
export function importExportJob(db: D1Database, storage: R2Bucket): CRMJobHandler {
  return {
    async prepare(job) {
      const payload = JSON.parse(job.payload) as { v?: unknown; phase?: unknown; export?: unknown }
      if (payload.v !== 1 || payload.phase !== 'results' || typeof payload.export !== 'string')
        throw new CRMJobPermanentError('invalid-request')
      if (job.cursor && JSON.parse(job.cursor).phase === 'assembly')
        return prepareImportAssembly(db, storage, job, payload.export)
      const { file, run, site } = await scopeImportExport(
        db,
        job.actor_id,
        job.site_id,
        payload.export,
      )
      if (file.job_id !== job.id) throw new CRMJobPermanentError('invalid-request')
      const cursor = job.cursor
        ? (JSON.parse(job.cursor) as { after: number; ordinal: number; rows: number })
        : { after: 0, ordinal: 0, rows: 0 }
      if (
        [cursor.after, cursor.ordinal, cursor.rows].some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        )
      )
        throw new CRMJobPermanentError('invalid-request')
      const encoder = new TextEncoder(),
        parts: string[] =
          cursor.ordinal === 0
            ? [importResultHeader(JSON.parse(run.headers_json), file.columns)]
            : [],
        snapshots: Array<{
          number: number
          revision: number
          hash: string | null
          appliedAt: string | null
          appliedAction: string | null
        }> = []
      let after = cursor.after,
        bytes = parts.length ? encoder.encode(parts[0]).length : 0
      for (let count = 0; count < 10; count++) {
        const row = await db
          .prepare(
            'SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number>?' +
              importResultCondition(!!file.errors_only) +
              ' ORDER BY number LIMIT 1',
          )
          .bind(run.id, after)
          .first<ImportRow>()
        if (!row) break
        const line = await importResultLine(
            db,
            job.actor_id,
            run,
            site.authorityRevision,
            row,
            file.columns,
          ),
          length = encoder.encode(line).length
        if (snapshots.length && bytes + length > 262144) break
        snapshots.push({
          number: row.number,
          revision: row.revision,
          hash: row.review_hash,
          appliedAt: row.applied_at,
          appliedAction: row.applied_action,
        })
        parts.push(line)
        bytes += length
        after = row.number
      }
      const processed = cursor.rows + snapshots.length,
        done = processed === file.expected_rows
      if (processed > file.expected_rows || (!done && !snapshots.length))
        throw new CRMJobPermanentError('stale-review')
      const key = crypto.randomUUID(),
        timestamp = new Date().toISOString(),
        guard = (name: string, condition: string, values: unknown[]) => [
          db
            .prepare(
              `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,
            )
            .bind(key + name, ...values),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + name),
        ]
      const writes = [
        ...guard(
          '_run',
          `EXISTS(SELECT 1 FROM vc_crm_import_runs WHERE id=? AND revision=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running')))`,
          [run.id, file.run_revision, file.run_updated_at],
        ),
        ...guard(
          '_expiry',
          'EXISTS(SELECT 1 FROM vc_crm_import_exports WHERE id=? AND job_id=? AND expires_at>?)',
          [file.id, job.id, timestamp],
        ),
        ...guard(
          '_rows',
          `NOT EXISTS(SELECT 1 FROM json_each(?) s LEFT JOIN vc_crm_import_rows r ON r.run_id=? AND r.number=json_extract(s.value,'$.number') WHERE r.number IS NULL OR r.revision<>json_extract(s.value,'$.revision') OR r.review_hash IS NOT json_extract(s.value,'$.hash') OR r.applied_at IS NOT json_extract(s.value,'$.appliedAt') OR r.applied_action IS NOT json_extract(s.value,'$.appliedAction'))`,
          [JSON.stringify(snapshots), run.id],
        ),
      ]
      if (done)
        writes.push(
          ...guard('_previous', importExportMismatch, [run.id, file.id]),
          ...guard(
            '_count',
            `(SELECT count(*) FROM vc_crm_import_rows WHERE run_id=?${importResultCondition(!!file.errors_only)})=?`,
            [run.id, file.expected_rows],
          ),
        )
      if (!parts.length)
        return {
          writes,
          cursor: done ? importAssemblyCursor() : JSON.stringify({ ...cursor, after }),
          processed: 0,
          done: false,
        }
      const content = encoder.encode(parts.join('')),
        sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join(''),
        objectKey = `crm/import-results/${encodeURIComponent(job.site_id)}/${file.id}/${job.id}-${job.fence}-${cursor.ordinal}-${key}.csv`
      const abandon = async () => {
        try {
          if (
            !(await db
              .prepare('SELECT object_key FROM vc_crm_import_export_chunks WHERE object_key=?')
              .bind(objectKey)
              .first())
          )
            await storage.delete(objectKey)
        } catch {
          /* Keep bytes when commit/publication outcome is unknown. */
        }
      }
      try {
        const object = await storage.put(objectKey, content, {
          sha256,
          httpMetadata: {
            contentType: 'text/csv; charset=utf-8',
            cacheControl: 'private, no-store',
          },
        })
        if (!object || object.size !== content.length)
          throw Error('Private result storage requires review.')
        await scopeImportExport(db, job.actor_id, job.site_id, file.id)
        writes.push(
          db
            .prepare(
              'INSERT INTO vc_crm_import_export_chunks(export_id,ordinal,object_key,sha256,bytes,rows,snapshots) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              file.id,
              cursor.ordinal,
              objectKey,
              sha256,
              content.length,
              snapshots.length,
              JSON.stringify(snapshots),
            ),
        )
        return {
          writes,
          cursor: done
            ? importAssemblyCursor()
            : JSON.stringify({ after, ordinal: cursor.ordinal + 1, rows: processed }),
          processed: snapshots.length,
          done: false,
          abandon,
        }
      } catch (error) {
        await abandon()
        throw error
      }
    },
  }
}
