import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/** Remove only filters owned by the retired content-type registry. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const [table, column] of [['saved_views', 'configuration'], ['_saved_views_v', 'version_configuration']] as const) {
    await db.run(sql.raw(`UPDATE ${table} SET ${column}=json_remove(${column},'$.query.postTypes') WHERE json_type(${column},'$.query.postTypes') IS NOT NULL;`))
    await db.run(sql.raw(`UPDATE ${table} SET ${column}=json_set(${column},'$.query.rules',json((SELECT coalesce(json_group_array(json(value)),'[]') FROM json_each(${table}.${column},'$.query.rules') WHERE json_extract(value,'$.field') IS NOT 'postType'))) WHERE EXISTS(SELECT 1 FROM json_each(${table}.${column},'$.query.rules') WHERE json_extract(value,'$.field')='postType');`))
  }
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Retired content-type filters require the database recovery point to restore.')
}
