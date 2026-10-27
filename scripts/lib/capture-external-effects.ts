import { hashToken } from '../../src/forms/security'

/** Run after the source write fence. Copy opaque reference hashes only. */
export async function captureExternalEffects(source:D1Database,operations:D1Database,release:string) {
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(release))throw Error('Invalid release identity.')
  let count=0
  for(const [provider,table,columns] of [
    ['stripe-test','form_payment_sessions',['checkout_ref','intent_ref']],
    ['email','vc_crm_email_outbox',['id','provider_id']],
  ] as const) {
    if(!await source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(table).first())continue
    for(const column of columns) {
      let after=''
      for(;;){
        const rows=(await source.prepare(`SELECT DISTINCT ${column} AS reference FROM ${table} WHERE ${column} IS NOT NULL AND ${column}>? ORDER BY ${column} LIMIT 100`).bind(after).all<{reference:string}>()).results
        if(!rows.length)break
        await operations.batch(await Promise.all(rows.map(async row=>operations.prepare("INSERT OR IGNORE INTO release_external_effects(provider,reference_hash,release_id,created_at) VALUES(?,?,?,?)").bind(provider,await hashToken(row.reference),release,new Date().toISOString()))))
        count+=rows.length;after=rows.at(-1)!.reference
      }
    }
  }
  return {capturedReferences:count,automaticReplay:false}
}
