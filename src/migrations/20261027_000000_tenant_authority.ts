import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { tenantSchemaV1 } from '../organizations/tenant-schema-v1'
import { taskTenantTables, taskTenantGuardsV1 } from '../organizations/task-tenant-schema-v1'
import { knowledgeSchemaV1 } from '../knowledge/schema-v1'
import { invitationSchemaV1 } from '../organizations/invitations'

/** Activation is a separate installer step after authority and settings seeds validate. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of tenantSchemaV1) await db.run(sql.raw(statement))
  for (const table of taskTenantTables) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`))
    if (!columns.some((column) => column.name === 'creation_tenant'))
      await db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN creation_tenant text REFERENCES vc_organizations(id)`))
    const site = table === 'review_tasks' ? 'document_site' : 'platform_site'
    await db.run(sql.raw(`UPDATE ${table} SET creation_tenant=COALESCE(
      (SELECT organization_id FROM vc_sites WHERE id=${table}.${site}),
      (SELECT organization_id FROM vc_sites WHERE id='default')) WHERE creation_tenant IS NULL`))
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS ${table}_creation_tenant_idx ON ${table}(creation_tenant)`))
  }
  for (const statement of taskTenantGuardsV1) await db.run(sql.raw(statement))
  for (const statement of knowledgeSchemaV1) await db.run(sql.raw(statement))
  for (const statement of invitationSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Tenant authority history must be retained. Restore a matching recovery point.')
}
