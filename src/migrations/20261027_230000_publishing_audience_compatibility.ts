import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { audienceTablesV1 } from '../publishing/audience-schema-v1'

/** Additive preparation only. No internal content is introduced by this migration. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const [, table, versions] of audienceTablesV1) {
    for (const [target, column] of [[table, 'audience'], ...(versions ? [[versions, 'version_audience']] : [])]) {
      const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${target}")`))
      if (!columns.some(({ name }) => name === column))
        await db.run(sql.raw(`ALTER TABLE "${target}" ADD COLUMN "${column}" text NOT NULL DEFAULT 'public' CHECK("${column}" IN ('public','intranet'))`))
      await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS "${target}_${column}_idx" ON "${target}"("${column}")`))
    }
  }
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Audience metadata must be retained. Restore an audience-compatible recovery point.')
}
