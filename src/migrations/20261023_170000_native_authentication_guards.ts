import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { nativeUserAuthenticationGuardsV2 } from '../organizations/mutation-guards'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql.raw('PRAGMA table_info(users)'))
  for (const statement of nativeUserAuthenticationGuardsV2(columns.map((column) => column.name)))
    await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Native authentication guards are retained. Use a reviewed recovery point to revert.',
  )
}
