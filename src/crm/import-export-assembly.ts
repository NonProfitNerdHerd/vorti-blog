import { CRMJobPermanentError, type CRMJob, type JobStep } from './jobs'
import { assertImportExportReadable } from './import-export-access'
import { importExportMismatch } from './import-export-job'
import {
  readImportResultPart,
  importResultPartBytes,
  type ImportResultChunk,
} from './import-export-parts'
type Cursor = {
  phase: 'assembly'
  initialized?: boolean
  step: number
  ordinal: number
  offset: number
  part: number
  prefix?: { key: string; bytes: number; sha256: string }
}
type Upload = { object_key: string; upload_id: string; bytes: number; chunks: number }
const digest = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
export const importAssemblyCursor = (): string =>
  JSON.stringify({ phase: 'assembly', step: 0, ordinal: 0, offset: 0, part: 1 })
export async function prepareImportAssembly(
  db: D1Database,
  storage: R2Bucket,
  job: CRMJob,
  id: string,
): Promise<JobStep> {
  const { file, run } = await assertImportExportReadable(db, job.actor_id, job.site_id, id)
  if (file.job_id !== job.id) throw new CRMJobPermanentError('invalid-request')
  const cursor = JSON.parse(job.cursor) as Cursor
  if (
    cursor.phase !== 'assembly' ||
    [cursor.step, cursor.ordinal, cursor.offset, cursor.part].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    cursor.part < 1 ||
    cursor.part > 10001
  )
    throw new CRMJobPermanentError('invalid-request')
  const key = crypto.randomUUID(),
    writes: D1PreparedStatement[] = []
  const guard = (suffix: string, condition: string, values: unknown[]) => {
    writes.push(
      db
        .prepare(
          `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,
        )
        .bind(key + suffix, ...values),
      db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + suffix),
    )
  }
  guard(
    '_run',
    `EXISTS(SELECT 1 FROM vc_crm_import_runs WHERE id=? AND revision=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running')))`,
    [run.id, file.run_revision, file.run_updated_at],
  )
  guard(
    '_expiry',
    'EXISTS(SELECT 1 FROM vc_crm_import_exports WHERE id=? AND job_id=? AND expires_at>?)',
    [id, job.id, new Date().toISOString()],
  )
  guard('_rows', importExportMismatch, [run.id, id])
  const upload = await db
    .prepare('SELECT * FROM vc_crm_import_export_uploads WHERE export_id=?')
    .bind(id)
    .first<Upload>()
  if (!upload) {
    if (cursor.step || cursor.ordinal || cursor.offset || cursor.part !== 1 || cursor.prefix)
      throw new CRMJobPermanentError('invalid-request')
    const size = (await db
      .prepare(
        'SELECT sum(bytes) AS bytes,count(*) AS chunks FROM vc_crm_import_export_chunks WHERE export_id=?',
      )
      .bind(id)
      .first<{ bytes: number; chunks: number }>())!
    const objectKey = `crm/import-results/${encodeURIComponent(job.site_id)}/${id}/assembled-${key}.csv`
    const session = await storage.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8', cacheControl: 'private, no-store' },
      customMetadata: { export: id, job: job.id, bytes: String(size.bytes) },
    })
    writes.push(
      db
        .prepare(
          'INSERT INTO vc_crm_import_export_uploads(export_id,object_key,upload_id,bytes,chunks) VALUES(?,?,?,?,?)',
        )
        .bind(id, objectKey, session.uploadId, size.bytes, size.chunks),
    )
    return {
      writes,
      cursor: JSON.stringify({ ...cursor, initialized: true }),
      processed: 0,
      done: false,
      abandon: async () => {
        try {
          if (
            !(await db
              .prepare('SELECT 1 FROM vc_crm_import_export_uploads WHERE object_key=?')
              .bind(objectKey)
              .first())
          )
            await session.abort()
        } catch {
          /* Retain an uncertain commit for recovery. */
        }
      },
    }
  }
  if (cursor.initialized !== true) throw new CRMJobPermanentError('invalid-request')
  if (cursor.ordinal > upload.chunks || (cursor.ordinal === upload.chunks && cursor.offset))
    throw new CRMJobPermanentError('invalid-request')
  const session = storage.resumeMultipartUpload(upload.object_key, upload.upload_id)
  if (cursor.ordinal === upload.chunks && !cursor.prefix) {
    const parts = (
      await db
        .prepare(
          'SELECT part_number,etag,bytes FROM vc_crm_import_export_steps WHERE export_id=? AND part_number IS NOT NULL ORDER BY part_number',
        )
        .bind(id)
        .all<{ part_number: number; etag: string; bytes: number }>()
    ).results
    if (
      !parts.length ||
      parts.length !== cursor.part - 1 ||
      parts.some(
        (part, index) =>
          part.part_number !== index + 1 ||
          (index < parts.length - 1 && part.bytes !== importResultPartBytes),
      ) ||
      parts.reduce((sum, part) => sum + part.bytes, 0) !== upload.bytes
    )
      throw new CRMJobPermanentError('invalid-request')
    let object = await storage.head(upload.object_key)
    if (!object)
      object = await session.complete(
        parts.map((part) => ({ partNumber: part.part_number, etag: part.etag })),
      )
    if (
      object.size !== upload.bytes ||
      object.customMetadata?.export !== id ||
      object.customMetadata?.job !== job.id ||
      object.customMetadata?.bytes !== String(upload.bytes)
    )
      throw Error('Completed import result requires storage review.')
    await assertImportExportReadable(db, job.actor_id, job.site_id, id)
    writes.push(
      db
        .prepare(
          'INSERT INTO vc_crm_import_export_files(export_id,object_key,bytes,etag,created_at) VALUES(?,?,?,?,?)',
        )
        .bind(id, upload.object_key, object.size, object.etag, new Date().toISOString()),
    )
    return {
      writes,
      cursor: job.cursor,
      processed: 0,
      done: true,
      result: { export: id, rows: file.expected_rows },
    }
  }
  if (cursor.part > 10000) throw Error('This result exceeds supported multipart capacity.')
  let prefix: Uint8Array | undefined
  if (cursor.prefix) {
    const retained = await db
      .prepare(
        'SELECT 1 FROM vc_crm_import_export_steps WHERE export_id=? AND step=? AND object_key=? AND bytes=? AND sha256=? AND part_number IS NULL',
      )
      .bind(id, cursor.step - 1, cursor.prefix.key, cursor.prefix.bytes, cursor.prefix.sha256)
      .first()
    if (!retained || cursor.prefix.bytes < 1 || cursor.prefix.bytes >= importResultPartBytes)
      throw new CRMJobPermanentError('invalid-request')
    const object = await storage.get(cursor.prefix.key)
    if (!object || object.size !== cursor.prefix.bytes)
      throw Error('Partial import result is unavailable.')
    prefix = new Uint8Array(await object.arrayBuffer())
    if ((await digest(prefix)) !== cursor.prefix.sha256)
      throw Error('Partial import result changed.')
  }
  const chunks = (
    await db
      .prepare(
        'SELECT ordinal,object_key,bytes,sha256 FROM vc_crm_import_export_chunks WHERE export_id=? AND ordinal>=? ORDER BY ordinal LIMIT 12',
      )
      .bind(id, cursor.ordinal)
      .all<ImportResultChunk>()
  ).results
  const part = await readImportResultPart(storage, {
    chunks,
    totalChunks: upload.chunks,
    position: cursor,
    prefix,
  })
  const sha256 = await digest(part.bytes)
  const next: Cursor = {
    phase: 'assembly',
    initialized: true,
    step: cursor.step + 1,
    ...part.position,
    part: cursor.part,
  }
  let objectKey: string | null = null,
    etag: string | null = null
  if (part.ready) {
    const uploaded = await session.uploadPart(cursor.part, part.bytes)
    etag = uploaded.etag
    next.part++
  } else {
    objectKey = `crm/import-results/${encodeURIComponent(job.site_id)}/${id}/partial-${job.id}-${job.fence}-${cursor.step}-${key}`
    next.prefix = { key: objectKey, bytes: part.bytes.length, sha256 }
  }
  const abandon = async () => {
    if (!objectKey) return
    try {
      if (
        !(await db
          .prepare('SELECT 1 FROM vc_crm_import_export_steps WHERE object_key=?')
          .bind(objectKey)
          .first())
      )
        await storage.delete(objectKey)
    } catch {
      /* Keep uncertain committed prefixes. */
    }
  }
  try {
    if (objectKey) {
      const stored = await storage.put(objectKey, part.bytes, {
        sha256,
        httpMetadata: {
          contentType: 'application/octet-stream',
          cacheControl: 'private, no-store',
        },
      })
      if (!stored || stored.size !== part.bytes.length)
        throw Error('Partial result storage requires review.')
    }
    await assertImportExportReadable(db, job.actor_id, job.site_id, id)
    writes.push(
      db
        .prepare(
          'INSERT INTO vc_crm_import_export_steps(export_id,step,object_key,bytes,sha256,part_number,etag,position) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          cursor.step,
          objectKey,
          part.bytes.length,
          sha256,
          part.ready ? cursor.part : null,
          etag,
          JSON.stringify(part.position),
        ),
    )
    return { writes, cursor: JSON.stringify(next), processed: 0, done: false, abandon }
  } catch (error) {
    await abandon()
    throw error
  }
}
