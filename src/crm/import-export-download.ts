import { SiteAccessError } from '../organizations/repository'
import { assertImportExportReadable } from './import-export-access'

/** Stream a published private object without per-chunk storage reads. */
export async function importExportDownload(
  db: D1Database,
  storage: R2Bucket,
  actor: number,
  site: string,
  runID: string,
  id: string,
) {
  const { file, run } = await assertImportExportReadable(db, actor, site, id)
  if (run.id !== runID) throw new SiteAccessError()
  const published = await db
    .prepare(
      `SELECT f.* FROM vc_crm_import_export_files f
    JOIN vc_crm_import_export_uploads u ON u.export_id=f.export_id AND u.object_key=f.object_key AND u.bytes=f.bytes
    JOIN vc_crm_import_exports e ON e.id=f.export_id JOIN vc_crm_jobs j ON j.id=e.job_id
    WHERE f.export_id=? AND j.status='completed'`,
    )
    .bind(id)
    .first<{ object_key: string; bytes: number; etag: string }>()
  if (!published) throw Error('This result file is not ready for download.')
  const object = await storage.get(published.object_key)
  if (!object) throw Error('The private result file is unavailable. Prepare a new download.')
  try {
    if (
      object.size !== published.bytes ||
      object.etag !== published.etag ||
      object.customMetadata?.export !== id ||
      object.customMetadata?.job !== file.job_id ||
      object.customMetadata?.bytes !== String(published.bytes)
    )
      throw Error('The private result file requires storage review.')
    await assertImportExportReadable(db, actor, site, id)
    return new Response(object.body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="import-${file.errors_only ? 'errors' : 'results'}.csv"`,
        'Content-Length': String(published.bytes),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Import-Matching-Rows': String(file.expected_rows),
      },
    })
  } catch (error) {
    await object.body.cancel().catch(() => {})
    throw error
  }
}
