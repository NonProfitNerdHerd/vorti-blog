import { atomicSiteMutation } from '../organizations/atomic'
import { SiteConflictError } from '../organizations/atomic'
type Intent = { action: string; site: string; type: string; intent: unknown }
async function hashIntent(input: Intent): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({
            action: input.action,
            site: input.site,
            type: input.type,
            intent: input.intent,
          }),
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export async function replayCRM(
  db: D1Database,
  actor: number,
  key: string,
  input: Intent,
): Promise<Record<string, unknown> | null> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new Error('Enter a valid operation key.')
  const row = await db
    .prepare('SELECT actor_id,fingerprint,result FROM vc_platform_operations WHERE operation_key=?')
    .bind(key)
    .first<{ actor_id: number; fingerprint: string; result: string }>()
  if (!row) return null
  if (row.actor_id !== actor || row.fingerprint !== (await hashIntent(input)))
    throw new SiteConflictError()
  return JSON.parse(row.result)
}
/** Shared private-record commit contract: actor + payload-bound retries, epoch fence, immutable audit. */
export async function commitCRM(input: {
  db: D1Database
  actor: number
  key: string
  site: string
  organization: string
  authorityRevision: number
  action: string
  type: string
  id: string
  before?: unknown
  after: unknown
  reason?: string
  /** Canonical client intent, excluding generated IDs and mutable database state. */
  intent: unknown
  write: D1PreparedStatement
  dependent?: D1PreparedStatement[]
  result: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { db } = input
  const fingerprint = await hashIntent(input)
  return atomicSiteMutation(db, {
    actor: input.actor,
    operationKey: input.key,
    fingerprint,
    write: input.write,
    afterWrite: [
      db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        )
        .bind(`${input.key}:authority`, input.organization, input.authorityRevision),
      db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(`${input.key}:authority`),
      ...(input.dependent || []),
      db
        .prepare(
          'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,reason,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          input.organization,
          input.site,
          input.actor,
          input.action,
          input.type,
          input.id,
          input.before == null ? null : JSON.stringify(input.before),
          JSON.stringify(input.after),
          input.reason || null,
          input.key,
          new Date().toISOString(),
        ),
    ],
    result: input.result,
  })
}
