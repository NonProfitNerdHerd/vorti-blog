import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import {
  guardedMutations,
  nativeMutationSchemaV1,
  nativeMutationGuardsV1,
} from '../organizations/mutation-guards'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of nativeMutationSchemaV1) await db.run(sql.raw(statement))
  const proofs = await db.all<{ name: string }>(
    sql.raw('PRAGMA table_info(vc_native_delete_proofs)'),
  )
  if (proofs.length && !proofs.some((field) => field.name === 'workspace_proof'))
    await db.run(sql.raw('ALTER TABLE vc_native_delete_proofs ADD COLUMN workspace_proof text'))
  for (const [, table, versions] of guardedMutations) {
    for (const [target, column] of [
      [table, 'platform_mutation_proof'],
      ...(versions ? [[versions, 'version_platform_mutation_proof']] : []),
    ]) {
      const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${target}")`))
      if (!columns.some((field) => field.name === column))
        await db.run(sql.raw(`ALTER TABLE "${target}" ADD COLUMN "${column}" text`))
    }
  }
  for (const statement of nativeMutationGuardsV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Authority guards are retained. Restore a reviewed recovery point to revert.')
}
