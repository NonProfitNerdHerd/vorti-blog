import type { FormPlatform } from './platform'

export interface MalwareScanner {
  name: string
  scan(input: { bytes: Uint8Array; mime: string; filename: string; signal: AbortSignal }): Promise<'clean' | 'rejected'>
}

/** Only an installed scanner can produce clean/rejected. Failures remain quarantined. */
export async function scanUpload(scanner: MalwareScanner | undefined, bytes: Uint8Array, mime: string, filename: string, timeoutMs = 15000): Promise<'unscanned' | 'clean' | 'rejected' | 'error'> {
  if (!scanner) return 'unscanned'
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      scanner.scan({ bytes, mime, filename, signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Scanner timed out.')) }, timeoutMs) }),
    ])
    return result === 'clean' || result === 'rejected' ? result : 'error'
  } catch { return 'error' } finally { if (timer) clearTimeout(timer) }
}

/** Claim before object deletion; acceptance and draft renewal cannot take a claimed file. */
export async function maintainForms(platform: FormPlatform, site: string, limit = 50, now = new Date().toISOString()) {
  const batch = Math.max(1, Math.min(100, Math.floor(limit)))
  const files = await platform.db.prepare("SELECT id, object_key FROM form_attachments WHERE site=? AND submission_i_d IS NULL AND (scan_status='deleting' OR expires_at<=?) ORDER BY id LIMIT ?").bind(site, now, batch).all<{ id: number; object_key: string }>()
  let attachments = 0, retrying = 0
  for (const file of files.results) {
    const claimed = await platform.db.prepare("UPDATE form_attachments SET scan_status='deleting' WHERE id=? AND site=? AND submission_i_d IS NULL AND (scan_status='deleting' OR expires_at<=?)").bind(file.id, site, now).run()
    if (claimed.meta.changes !== 1) continue
    // Never let a malformed legacy record target the site's public media bucket keys.
    if (!file.object_key.startsWith(`form-private/${site}/`)) { retrying++; continue }
    try {
      await platform.storage.delete(file.object_key)
      const removed = await platform.db.prepare("DELETE FROM form_attachments WHERE id=? AND site=? AND submission_i_d IS NULL AND scan_status='deleting'").bind(file.id, site).run()
      attachments += removed.meta.changes
    } catch { retrying++ } // Keep the object key and claim for the next bounded run.
  }
  const drafts = await platform.db.prepare('DELETE FROM form_drafts WHERE id IN (SELECT id FROM form_drafts WHERE site=? AND (expires_at<=? OR revoked_at IS NOT NULL) ORDER BY id LIMIT ?)').bind(site, now, batch).run()
  const holds = await platform.db.prepare("UPDATE form_booking_holds SET status='released' WHERE site=? AND status='held' AND expires_ms<=?").bind(site, Date.parse(now)).run()
  const expired = await platform.db.prepare("SELECT id,object_key FROM form_exports WHERE site=? AND object_key IS NOT NULL AND ((status='complete' AND expires_at<=?) OR status='expired') ORDER BY id LIMIT ?").bind(site, now, batch).all<{ id: number; object_key: string }>()
  let exports = 0
  for (const file of expired.results) {
    if (!file.object_key.startsWith(`form-private/${site}/exports/`)) { retrying++; continue }
    await platform.db.prepare("UPDATE form_exports SET status='expired' WHERE id=? AND site=? AND object_key=?").bind(file.id, site, file.object_key).run()
    try {
      await platform.storage.delete(file.object_key)
      exports += (await platform.db.prepare("UPDATE form_exports SET object_key=NULL WHERE id=? AND site=? AND status='expired' AND object_key=?").bind(file.id, site, file.object_key).run()).meta.changes
    } catch { retrying++ }
  }
  // Recover a request interrupted between creating its export record and queuing work.
  await platform.db.prepare("INSERT OR IGNORE INTO form_outbox (label,site,event_i_d,kind,status,payload,attempts,next_attempt_at) SELECT 'Generate entries export',site,'export-' || id,'form-export','pending',json_object('action',json_object('id','export-' || id,'kind','form-export','name','Generate entries export','config',json_object('exportID',id))),0,? FROM form_exports WHERE site=? AND status='pending' LIMIT ?").bind(now, site, batch).run()
  return { attachments, retrying, drafts: drafts.meta.changes, expiredHolds: holds.meta.changes, exports }
}
