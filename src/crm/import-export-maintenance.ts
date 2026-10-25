/** Bounded, restart-safe private-object retention. Records and source histories remain intact. */
export async function cleanImportResults(db: D1Database, storage: R2Bucket, now = Date.now()) {
  const timestamp = new Date(now).toISOString()
  async function state(name: string) {
    await db
      .prepare('INSERT OR IGNORE INTO vc_crm_maintenance(name,cursor,updated_at) VALUES(?,?,?)')
      .bind(name, '', timestamp)
      .run()
    const row = await db
      .prepare('SELECT cursor,revision FROM vc_crm_maintenance WHERE name=?')
      .bind(name)
      .first<{ cursor: string; revision: number }>()
    if (!row) throw Error('Import result maintenance is unavailable.')
    return row
  }
  async function advance(name: string, cursor: string, revision: number) {
    await db
      .prepare(
        'UPDATE vc_crm_maintenance SET cursor=?,revision=revision+1,updated_at=? WHERE name=? AND revision=?',
      )
      .bind(cursor, timestamp, name, revision)
      .run()
  }
  async function expire(id: string) {
    // A worker that prepared before expiry must lose its checkpoint before bytes disappear.
    await db
      .prepare(
        `UPDATE vc_crm_jobs SET status='failed',fence=fence+1,lease_until=NULL,error='Result file expired. Prepare a new download.',updated_at=?
      WHERE status IN('pending','running') AND id IN(SELECT job_id FROM vc_crm_import_exports WHERE id=? AND expires_at<=?)`,
      )
      .bind(timestamp, id, timestamp)
      .run()
  }
  async function record(kind: 'object' | 'upload', key: string, id: string | null) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO vc_crm_import_export_cleanup(kind,object_key,export_id,removed_at) VALUES(?,?,?,?)',
      )
      .bind(kind, key, id, timestamp)
      .run()
  }
  const uploadState = await state('import-result-uploads')
  const uploads = (
    await db
      .prepare(
        `SELECT u.*,e.job_id FROM vc_crm_import_export_uploads u JOIN vc_crm_import_exports e ON e.id=u.export_id
    WHERE e.expires_at<=? AND u.export_id>? AND NOT EXISTS(SELECT 1 FROM vc_crm_import_export_cleanup c WHERE c.kind='upload' AND c.object_key=u.object_key)
    ORDER BY u.export_id LIMIT 25`,
      )
      .bind(timestamp, uploadState.cursor)
      .all<{ export_id: string; object_key: string; upload_id: string; job_id: string }>()
  ).results
  let uploadsSettled = 0,
    uploadFailures = 0
  for (const upload of uploads) {
    await expire(upload.export_id)
    try {
      try {
        await storage.resumeMultipartUpload(upload.object_key, upload.upload_id).abort()
      } catch (error) {
        // Completed uploads no longer have a session. Confirm the exact retained object.
        const published = await db
          .prepare('SELECT 1 FROM vc_crm_import_export_files WHERE export_id=? AND object_key=?')
          .bind(upload.export_id, upload.object_key)
          .first()
        if (!published) {
          const object = await storage.head(upload.object_key)
          if (
            !object ||
            object.customMetadata?.export !== upload.export_id ||
            object.customMetadata?.job !== upload.job_id
          )
            throw error
        }
      }
      await record('upload', upload.object_key, upload.export_id)
      uploadsSettled++
    } catch {
      uploadFailures++
    }
  }
  await advance(
    'import-result-uploads',
    uploads.length === 25 ? uploads.at(-1)!.export_id : '',
    uploadState.revision,
  )
  const objectState = await state('import-result-objects')
  const page = await storage.list({
    prefix: 'crm/import-results/',
    limit: 100,
    cursor: objectState.cursor || undefined,
  })
  let removed = 0
  for (const object of page.objects) {
    if (object.uploaded.getTime() > now - 3600000) continue
    const match = /^crm\/import-results\/([^/]+)\/([a-f0-9-]{36})\/(.+)$/.exec(object.key)
    if (!match) continue
    let site: string
    try {
      site = decodeURIComponent(match[1])
    } catch {
      continue
    }
    const file = await db
      .prepare(
        `SELECT e.id,e.expires_at,j.status,j.lease_until FROM vc_crm_import_exports e JOIN vc_crm_import_runs r ON r.id=e.run_id
      JOIN vc_crm_jobs j ON j.id=e.job_id WHERE e.id=? AND r.site_id=?`,
      )
      .bind(match[2], site)
      .first<{ id: string; expires_at: string; status: string; lease_until: string | null }>()
    if (file && file.expires_at <= timestamp) await expire(file.id)
    else if (file) {
      if (file.status === 'running' && file.lease_until && file.lease_until > timestamp) continue
      const retained = await db
        .prepare(
          `SELECT 1 WHERE EXISTS(SELECT 1 FROM vc_crm_import_export_chunks WHERE export_id=? AND object_key=?)
        OR EXISTS(SELECT 1 FROM vc_crm_import_export_steps WHERE export_id=? AND object_key=?)
        OR EXISTS(SELECT 1 FROM vc_crm_import_export_uploads WHERE export_id=? AND object_key=?)
        OR EXISTS(SELECT 1 FROM vc_crm_import_export_files WHERE export_id=? AND object_key=?)`,
        )
        .bind(file.id, object.key, file.id, object.key, file.id, object.key, file.id, object.key)
        .first()
      if (retained) continue
    } else {
      // A mismatched chapter prefix is never evidence that a retained file is orphaned.
      if (await db.prepare('SELECT 1 FROM vc_crm_import_exports WHERE id=?').bind(match[2]).first())
        continue
    }
    try {
      await storage.delete(object.key)
    } catch (error) {
      if (await storage.head(object.key)) throw error
    }
    await record('object', object.key, file?.id ?? null)
    if (file)
      await db
        .prepare(
          'UPDATE vc_crm_import_export_chunks SET deleted_at=? WHERE export_id=? AND object_key=? AND deleted_at IS NULL',
        )
        .bind(timestamp, file.id, object.key)
        .run()
    removed++
  }
  await advance('import-result-objects', page.truncated ? page.cursor : '', objectState.revision)
  return {
    examined: page.objects.length,
    removed,
    uploadsSettled,
    uploadFailures,
    more: page.truncated || uploads.length === 25,
  }
}
