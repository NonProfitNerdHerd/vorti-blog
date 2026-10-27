import { createHash } from 'node:crypto'

const quote = (value: string) => `"${value.replaceAll('"','""')}"`
function prefix(run: string) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(run)) throw Error('Invalid release run identity.')
  return `vc_release_freeze_${run.replaceAll('-','_')}_`
}

/** Install only after public traffic and consumers are in maintenance. Existing
 * in-flight writers are then rejected by SQLite before recovery is captured. */
export async function freezeDatabase(db: D1Database, run: string) {
  const namePrefix = prefix(run)
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7)<>'sqlite_' AND substr(name,1,4)<>'_cf_' ORDER BY name").all<{name:string}>()).results.map(row=>row.name)
  if (!tables.includes('payload_migrations') || !tables.includes('users')) throw Error('The intended application schema is missing.')
  const triggers = tables.flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>({name:`${namePrefix}${createHash('sha256').update(table).digest('hex').slice(0,16)}_${action.toLowerCase()}`,table,action})))
  // Restart-safe: a failed batch leaves the already-installed guards in place.
  for(let offset=0;offset<triggers.length;offset+=50) await db.batch(triggers.slice(offset,offset+50).map(trigger=>db.prepare(`CREATE TRIGGER IF NOT EXISTS ${quote(trigger.name)} BEFORE ${trigger.action} ON ${quote(trigger.table)} BEGIN SELECT RAISE(ABORT,'Application maintenance is active'); END`)))
  const installed = (await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND substr(name,1,?)=?").bind(namePrefix.length,namePrefix).all<{name:string}>()).results.map(row=>row.name)
  if(triggers.some(trigger=>!installed.includes(trigger.name)))throw Error('Database freeze verification failed.')
  return {run,tables:tables.length,triggers:triggers.map(trigger=>trigger.name)}
}

export async function thawDatabase(db:D1Database,run:string) {
  const namePrefix=prefix(run)
  const triggers=(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND substr(name,1,?)=?").bind(namePrefix.length,namePrefix).all<{name:string}>()).results
  for(let offset=0;offset<triggers.length;offset+=50)await db.batch(triggers.slice(offset,offset+50).map(trigger=>db.prepare(`DROP TRIGGER ${quote(trigger.name)}`)))
  return {removed:triggers.length}
}
