import { FormHTTPError } from './security'

/** Transfer the saved snapshot and its files together; a stale resume must not steal a newer session. */
export async function transferProgress(db: D1Database, input: {
  id: number | string; site: string; revision: string; previousSession: string; session: string
  updatedAt: string; expiresAt: string; tokenHash: string; files: string[]
}, now = new Date().toISOString()): Promise<void> {
  const files = [...new Set(input.files)]
  const guards = files.map(() => "EXISTS (SELECT 1 FROM form_attachments WHERE id=? AND site=? AND revision=? AND session_hash=? AND submission_i_d IS NULL AND expires_at>? AND scan_status!='deleting')")
  const update = db.prepare(`UPDATE form_drafts SET session_hash=?,token_hash=?,updated_at=? WHERE id=? AND site=? AND revision=? AND session_hash=? AND updated_at=? AND revoked_at IS NULL AND expires_at>?${guards.length ? ` AND ${guards.join(' AND ')}` : ''}`).bind(
    input.session, input.tokenHash, now, input.id, input.site, input.revision, input.previousSession, input.updatedAt, now,
    ...files.flatMap(id => [id, input.site, input.revision, input.previousSession, now]),
  )
  const transfers = files.map(id => db.prepare(`UPDATE form_attachments SET session_hash=?,expires_at=? WHERE id=? AND site=? AND revision=? AND session_hash=? AND EXISTS (SELECT 1 FROM form_drafts WHERE id=? AND site=? AND session_hash=?)`).bind(input.session, input.expiresAt, id, input.site, input.revision, input.previousSession, input.id, input.site, input.session))
  const result = await db.batch([update, ...transfers])
  if (result[0].meta.changes !== 1) throw new FormHTTPError('Saved progress changed in another session, or a saved file is unavailable. Reload the saved draft and try again.', 409)
}
