/** Internal bounded sweep. Never removes a published file or a live lease's staged bytes. */
export async function cleanDocumentOrphans(db: D1Database, storage: R2Bucket, now = Date.now()) {
  const timestamp = new Date(now).toISOString()
  await db
    .prepare(
      "INSERT OR IGNORE INTO vc_crm_maintenance(name,cursor,updated_at) VALUES('document-orphans','',?)",
    )
    .bind(timestamp)
    .run()
  const state = await db
    .prepare("SELECT cursor,revision FROM vc_crm_maintenance WHERE name='document-orphans'")
    .first<{ cursor: string; revision: number }>()
  if (!state) throw new Error('Document maintenance state is unavailable.')
  const page = await storage.list({
    prefix: 'crm/documents/',
    limit: 100,
    cursor: state.cursor || undefined,
  })
  let removed = 0
  for (const object of page.objects) {
    if (object.uploaded.getTime() > now - 3600000) continue
    const match = /^crm\/documents\/([^/]+)\/([a-f0-9-]{36})\/([a-f0-9-]{36})-(\d+)\.pdf$/.exec(
      object.key,
    )
    if (!match) continue
    let site: string
    try {
      site = decodeURIComponent(match[1])
    } catch {
      continue
    }
    const document = match[2],
      jobID = match[3],
      fence = Number(match[4])
    if (!Number.isSafeInteger(fence)) continue
    const job = await db
      .prepare(
        "SELECT status,fence,lease_until FROM vc_crm_jobs WHERE id=? AND site_id=? AND kind='correspondence' AND json_extract(payload,'$.document')=?",
      )
      .bind(jobID, site, document)
      .first<{ status: string; fence: number; lease_until: string | null }>()
    if (
      job?.status === 'running' &&
      job.fence === fence &&
      job.lease_until &&
      job.lease_until > timestamp
    )
      continue
    // A completed job may have published between listing and the lease read. Check after it.
    const published = await db
      .prepare('SELECT document_id FROM vc_crm_document_files WHERE object_key=?')
      .bind(object.key)
      .first()
    if (published) continue
    await storage.delete(object.key)
    removed++
  }
  const next = page.truncated ? page.cursor : ''
  await db
    .prepare(
      "UPDATE vc_crm_maintenance SET cursor=?,revision=revision+1,updated_at=? WHERE name='document-orphans' AND revision=?",
    )
    .bind(next, timestamp, state.revision)
    .run()
  return { examined: page.objects.length, removed, more: page.truncated }
}
