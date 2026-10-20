import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { defaultOrganizationSeed, organizationSchema } from '../organizations/schema-v1'

/** Internal platform tables use the same explicit SQL migration pattern as Forms runtime storage.
 * This does not expose tenant creation or change existing content/workspace authorization.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of [...organizationSchema, ...defaultOrganizationSeed])
    await db.run(sql.raw(statement))
  await db.run(sql`INSERT OR IGNORE INTO vc_platform_audit
    (id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at)
    SELECT 'operator-migration-' || user_id,'default','default',user_id,'operator.compatibility-mapped','user',CAST(user_id AS TEXT),
      '{"source":"legacy-administrator","installationOperator":true}',
      'migration-20261020-operator-' || user_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM vc_installation_operators`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Organization authority and audit history are preserved. Restore a reviewed D1 recovery point to revert this migration.',
  )
}
