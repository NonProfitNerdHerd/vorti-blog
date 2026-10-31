import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { crmTaskSchemaV3 } from '../crm/task-context-v3'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of crmTaskSchemaV3) await db.run(sql.raw(statement))
  // Preserve CRM availability for preview tenants that enabled CRM before this dependency existed.
  await db.run(sql.raw(`UPDATE vc_tenant_features SET available=1,revision=revision+1 WHERE feature='tasks' AND available=0 AND tenant_id IN (SELECT tenant_id FROM vc_tenant_features WHERE feature='crm' AND available=1)`))
  await db.run(sql.raw(`INSERT INTO vc_site_features(site_id,feature,value)
    SELECT s.id,'tasks','enabled' FROM vc_sites s JOIN vc_tenant_features tenant_crm ON tenant_crm.tenant_id=s.organization_id AND tenant_crm.feature='crm' AND tenant_crm.available=1
    WHERE s.archived=0
    AND COALESCE((SELECT f.value FROM vc_site_features f JOIN vc_site_ancestry a ON a.ancestor_id=f.site_id WHERE a.descendant_id=s.id AND f.feature='crm' AND f.value<>'inherit' ORDER BY a.distance LIMIT 1),'enabled')='enabled'
    AND COALESCE((SELECT f.value FROM vc_site_features f JOIN vc_site_ancestry a ON a.ancestor_id=f.site_id WHERE a.descendant_id=s.id AND f.feature='tasks' AND f.value<>'inherit' ORDER BY a.distance LIMIT 1),'enabled')='disabled'
    ON CONFLICT(site_id,feature) DO UPDATE SET value='enabled',revision=vc_site_features.revision+1`))
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Task source links and feature reconciliation are retained.')
}
