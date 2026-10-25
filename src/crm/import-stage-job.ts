import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { scopeImportRun } from './import-access'
import { csvImportRows, type ImportTableRow } from './import-csv'
import { readImportWorkbook, importWorkbookRows } from './import-xlsx'
import { verifyImportObject } from './import-upload'
import type { ImportSourceCursor } from './import-files'

/** Raw-row bookkeeping only. No domain/source-identifier writes occur here. */
export function importStageJob(db: D1Database, storage: R2Bucket): CRMJobHandler {
  return {
    async prepare(job) {
      let payload: { v?: unknown; phase?: unknown; run?: unknown; revision?: unknown }
      try {
        payload = JSON.parse(job.payload)
      } catch {
        throw new CRMJobPermanentError('invalid-request')
      }
      if (
        payload.v !== 1 ||
        payload.phase !== 'stage' ||
        typeof payload.run !== 'string' ||
        !Number.isSafeInteger(payload.revision)
      )
        throw new CRMJobPermanentError('invalid-request')
      const { run } = await scopeImportRun(db, job.actor_id, job.site_id, payload.run, 'edit')
      if (
        run.status !== 'draft' ||
        run.stage_state !== 'staging' ||
        run.job_id !== job.id ||
        run.revision !== payload.revision ||
        !run.file_uploaded_at ||
        (job.cursor && job.cursor !== run.stage_cursor)
      )
        throw new CRMJobPermanentError('stale-review')
      let cursor: ImportSourceCursor, headers: string[]
      try {
        cursor = JSON.parse(run.stage_cursor)
        headers = JSON.parse(run.headers_json)
      } catch {
        throw new CRMJobPermanentError('invalid-request')
      }
      if (
        !Array.isArray(headers) ||
        !headers.length ||
        headers.some((header) => typeof header !== 'string') ||
        cursor.kind !== run.file_kind
      )
        throw new CRMJobPermanentError('invalid-request')
      if (
        cursor.kind === 'csv' &&
        (!Number.isSafeInteger(cursor.resume?.offset) ||
          cursor.resume.offset < 0 ||
          cursor.resume.offset > run.file_size ||
          !Number.isSafeInteger(cursor.resume.row) ||
          cursor.resume.row <= run.header_row ||
          typeof cursor.resume.skipLF !== 'boolean')
      )
        throw new CRMJobPermanentError('invalid-request')
      if (
        cursor.kind === 'xlsx' &&
        (!Number.isSafeInteger(cursor.after) || cursor.after < run.header_row)
      )
        throw new CRMJobPermanentError('invalid-request')
      const key = crypto.randomUUID(),
        guard = (suffix: string, sql: string, values: unknown[]) => [
          db
            .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
            .bind(key + '_' + suffix, ...values),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + '_' + suffix),
        ]
      const writes = guard(
        'run',
        `SELECT ?,count(*) FROM vc_crm_import_runs WHERE id=? AND actor_id=? AND site_id=? AND status='draft' AND stage_state='staging' AND revision=? AND job_id=? AND stage_cursor=?`,
        [run.id, job.actor_id, job.site_id, run.revision, job.id, run.stage_cursor],
      )
      const rows: Array<{ row: ImportTableRow; json: string }> = []
      let next = cursor,
        done = true,
        scanned = 0,
        bytes = 0
      const accept = (raw: ImportTableRow, after: ImportSourceCursor) => {
        const values = [...raw.values],
          issues = [...raw.issues]
        if (run.file_kind === 'xlsx') while (values.length < headers.length) values.push('')
        if (values.length > headers.length)
          issues.push({
            column: -1,
            message: 'The row has more columns than the selected header. Review the source file.',
          })
        if (values.every((value) => !value.trim()) && !issues.length) {
          next = after
          scanned++
          return scanned < 200
        }
        const json = JSON.stringify(values),
          size = new TextEncoder().encode(json).length
        if (size > 1048576) throw new Error('Choose source records smaller than 1 MiB for review.')
        if (rows.length && bytes + size > 1048576) return false
        rows.push({ row: { number: raw.number, values, issues }, json })
        bytes += size
        scanned++
        next = after
        return rows.length < 25 && scanned < 200
      }
      try {
        if (cursor.kind === 'csv') {
          if (cursor.resume.offset === run.file_size)
            verifyImportObject(await storage.head(run.file_key), run)
          else {
            const object = await storage.get(run.file_key, {
              range: { offset: cursor.resume.offset },
            })
            try {
              verifyImportObject(object, run)
            } catch (error) {
              await object?.body.cancel().catch(() => {})
              throw error
            }
            for await (const row of csvImportRows(object!.body, {
              delimiter: run.delimiter,
              resume: cursor.resume,
            })) {
              if (!accept(row, { kind: 'csv', resume: row.next })) {
                done = false
                break
              }
            }
          }
        } else {
          const object = await storage.get(run.file_key)
          try {
            verifyImportObject(object, run)
          } catch (error) {
            await object?.body.cancel().catch(() => {})
            throw error
          }
          const book = await readImportWorkbook(new Uint8Array(await object!.arrayBuffer()))
          for (const row of importWorkbookRows(book, run.sheet_name, cursor.after)) {
            if (!accept(row, { kind: 'xlsx', after: row.number })) {
              done = false
              break
            }
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || !/^(Choose|Enter)/.test(error.message)) throw error
        writes.push(
          db
            .prepare(
              "UPDATE vc_crm_import_runs SET stage_state='failed',stage_error=?,updated_at=? WHERE id=? AND revision=? AND job_id=? AND stage_state='staging'",
            )
            .bind(error.message, new Date().toISOString(), run.id, run.revision, job.id),
          ...guard('failed', 'VALUES(?,changes())', []),
        )
        return {
          writes,
          cursor: JSON.stringify(next),
          processed: 0,
          done: true,
          result: { run: run.id, sourceInvalid: true },
        }
      }
      for (const { row, json } of rows)
        writes.push(
          db
            .prepare(
              'INSERT INTO vc_crm_import_rows(run_id,number,data_json,parse_issues) VALUES(?,?,?,?)',
            )
            .bind(run.id, row.number, json, JSON.stringify(row.issues)),
        )
      const encoded = JSON.stringify(next)
      writes.push(
        db
          .prepare(
            "UPDATE vc_crm_import_runs SET stage_cursor=?,stage_state=?,stage_error=NULL,updated_at=? WHERE id=? AND revision=? AND job_id=? AND stage_state='staging'",
          )
          .bind(
            encoded,
            done ? 'review' : 'staging',
            new Date().toISOString(),
            run.id,
            run.revision,
            job.id,
          ),
        ...guard('checkpoint', 'VALUES(?,changes())', []),
      )
      return {
        writes,
        cursor: encoded,
        processed: rows.length,
        done,
        result: done ? { run: run.id, staged: true } : undefined,
      }
    },
  }
}
