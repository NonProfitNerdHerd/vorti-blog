import { prepareAtomicSiteCheckpoint, type AtomicSiteMutation } from '../organizations/atomic'
import { prepareCRMCheckpoint, type CRMCommit } from './mutations'

/** Server-only execution boundary for reviewed domain jobs. Repositories still
 * perform their normal validation and authorization. Preparing never executes a
 * write, receipt or audit. A job must commit every statement under its own lease,
 * approval, source-ID and row-progress guards in one D1 batch.
 */
export class PreparedCRMMutations {
  private entries: Array<
    { kind: 'crm'; mutation: CRMCommit } | { kind: 'atomic'; mutation: AtomicSiteMutation }
  > = []
  constructor(
    private db: D1Database,
    private actor: number,
  ) {}
  readonly commit = async (mutation: CRMCommit) => {
    if (mutation.db !== this.db || mutation.actor !== this.actor)
      throw new Error('Invalid prepared mutation context.')
    this.entries.push({ kind: 'crm', mutation })
    return mutation.result
  }
  readonly atomic = async (db: D1Database, mutation: AtomicSiteMutation) => {
    if (db !== this.db || mutation.actor !== this.actor)
      throw new Error('Invalid prepared mutation context.')
    this.entries.push({ kind: 'atomic', mutation })
    return mutation.result
  }
  get count() {
    return this.entries.length
  }
  descriptions() {
    return this.entries.flatMap((entry) =>
      entry.kind === 'crm'
        ? [
            {
              action: entry.mutation.action,
              id: entry.mutation.id,
              before: structuredClone(entry.mutation.before ?? null),
              after: structuredClone(entry.mutation.after),
            },
          ]
        : [],
    )
  }
  async statements() {
    const writes: D1PreparedStatement[] = []
    for (const entry of this.entries)
      writes.push(
        ...(entry.kind === 'crm'
          ? await prepareCRMCheckpoint(entry.mutation)
          : prepareAtomicSiteCheckpoint(this.db, entry.mutation)),
      )
    return writes
  }
}
