/** Only unpublished, expired/cancelled uploads are eligible for cleanup. Published files remain retained. */
export async function cleanCRMAttachments(db: D1Database, storage: R2Bucket, now = Date.now()) {
  const timestamp = new Date(now).toISOString(),
    cutoff = new Date(now - 86400000).toISOString()
  const expired = (
    await db
      .prepare(
        "SELECT id,revision FROM vc_crm_attachments WHERE state='staged' AND created_at<=? ORDER BY created_at,id LIMIT 100",
      )
      .bind(cutoff)
      .all<{ id: string; revision: number }>()
  ).results
  for (const file of expired)
    await db.batch([
      db
        .prepare(
          "UPDATE vc_crm_attachments SET state='expired',revision=revision+1,updated_at=? WHERE id=? AND state='staged' AND ready_at IS NULL AND revision=? AND created_at<=?",
        )
        .bind(timestamp, file.id, file.revision, cutoff),
      db
        .prepare(
          "INSERT INTO vc_crm_attachment_events(id,attachment_id,action,actor_id,operation_key,created_at) SELECT ?,?,'expired',NULL,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          file.id,
          `attachment-expired-${file.id}-${file.revision}`,
          timestamp,
        ),
    ])
  await db
    .prepare(
      "INSERT OR IGNORE INTO vc_crm_maintenance(name,cursor,updated_at) VALUES('attachment-orphans','',?)",
    )
    .bind(timestamp)
    .run()
  const state = await db
    .prepare("SELECT cursor,revision FROM vc_crm_maintenance WHERE name='attachment-orphans'")
    .first<{ cursor: string; revision: number }>()
  if (!state) throw new Error('Attachment maintenance state is unavailable.')
  const page = await storage.list({
    prefix: 'crm/attachments/',
    limit: 100,
    cursor: state.cursor || undefined,
  })
  let removed = 0
  for (const object of page.objects) {
    if (
      object.uploaded.getTime() > now - 3600000 ||
      !/^crm\/attachments\/[^/]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(object.key)
    )
      continue
    const file = await db
      .prepare('SELECT state,ready_at FROM vc_crm_attachments WHERE object_key=?')
      .bind(object.key)
      .first<{ state: string; ready_at: string | null }>()
    // Terminal unpublished states cannot be restored by an uploader; no publisher can race this deletion.
    if (!file || file.ready_at !== null || !['expired', 'cancelled'].includes(file.state)) continue
    await storage.delete(object.key)
    removed++
  }
  await db
    .prepare(
      "UPDATE vc_crm_maintenance SET cursor=?,revision=revision+1,updated_at=? WHERE name='attachment-orphans' AND revision=?",
    )
    .bind(page.truncated ? page.cursor : '', timestamp, state.revision)
    .run()
  return {
    examined: page.objects.length,
    expiredExamined: expired.length,
    removed,
    more: page.truncated,
  }
}
