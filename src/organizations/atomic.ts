export class SiteConflictError extends Error {
  readonly status = 409
  constructor() {
    super('This record or policy changed. Reload and review before saving.')
  }
}
export interface AtomicSiteMutation {
  operationKey: string
  actor: number
  fingerprint: string
  /** First statement must be one revision-checked write, followed immediately by the guard. */
  write: D1PreparedStatement
  /** Audit and dependent changes all participate in the same D1 batch. */
  afterWrite: D1PreparedStatement[]
  result: Record<string, unknown>
}
function validateMutation(mutation: AtomicSiteMutation) {
  if (
    !/^[a-zA-Z0-9_-]{16,128}$/.test(mutation.operationKey) ||
    !Number.isSafeInteger(mutation.actor) ||
    mutation.actor <= 0 ||
    !/^[a-f0-9]{64}$/.test(mutation.fingerprint)
  )
    throw new Error('Invalid mutation operation identity.')
}
/** Prepare only. The caller must execute the whole plan in one guarded D1 batch.
 * Durable jobs add their lease/cursor fence before these statements.
 */
export function prepareAtomicSiteCheckpoint(
  db: D1Database,
  mutation: AtomicSiteMutation,
): D1PreparedStatement[] {
  validateMutation(mutation)
  return [
    mutation.write,
    db
      .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
      .bind(mutation.operationKey),
    ...mutation.afterWrite,
    db
      .prepare(
        'INSERT INTO vc_platform_operations(operation_key,actor_id,fingerprint,result,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        mutation.operationKey,
        mutation.actor,
        mutation.fingerprint,
        JSON.stringify(mutation.result),
        new Date().toISOString(),
      ),
    db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(mutation.operationKey),
  ]
}
/** Not a cross-request transaction. Uniqueness and CAS are enforced inside one D1 batch. */
export async function atomicSiteMutation(
  db: D1Database,
  mutation: AtomicSiteMutation,
): Promise<Record<string, unknown>> {
  validateMutation(mutation)
  const replay = async (): Promise<Record<string, unknown> | null> => {
    const receipt = await db
      .prepare(
        'SELECT actor_id,fingerprint,result FROM vc_platform_operations WHERE operation_key=?',
      )
      .bind(mutation.operationKey)
      .first<{ actor_id: number; fingerprint: string; result: string }>()
    if (!receipt) return null
    if (receipt.actor_id !== mutation.actor || receipt.fingerprint !== mutation.fingerprint)
      throw new SiteConflictError()
    return JSON.parse(receipt.result) as Record<string, unknown>
  }
  const previous = await replay()
  if (previous) return previous
  try {
    await db.batch(prepareAtomicSiteCheckpoint(db, mutation))
    return mutation.result
  } catch (error) {
    const receipt = await replay()
    if (receipt) return receipt
    if (
      error instanceof Error &&
      /vc_write_guards|affected=1|CHECK constraint failed/.test(error.message)
    )
      throw new SiteConflictError()
    throw error
  }
}
