import { applicationFeatures } from '../../src/organizations/permission-catalog'
import { siteSettingDefaults, tenantSettingDefaults } from '../../src/organizations/scoped-settings'

/** Operational installer only. Does not create or change authentication credentials. */
export async function bootstrapTenant(
  database: D1Database,
  input: { tenant: string; site: string; administratorEmail: string },
) {
  const email = input.administratorEmail.trim().toLowerCase()
  if (!email || !email.includes('@')) throw Error('Provide the intended administrator identity.')
  const users = await database
    .prepare(
      `SELECT u.id FROM users u WHERE lower(trim(u.email))=?
    AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=u.id AND a.disabled=1)`,
    )
    .bind(email)
    .all<{ id: number }>()
  if (users.results.length !== 1)
    throw Error('Exactly one active account must match the bootstrap identity.')
  const site = await database
    .prepare(
      'SELECT id FROM vc_sites WHERE id=? AND organization_id=? AND parent_id IS NULL AND archived=0',
    )
    .bind(input.site, input.tenant)
    .first()
  if (!site) throw Error('The intended primary site must exist in the intended tenant.')
  if (
    await database
      .prepare('SELECT tenant_id FROM vc_tenant_installation WHERE tenant_id=?')
      .bind(input.tenant)
      .first()
  )
    throw Error('This tenant is already installed. Use the data-preserving upgrade mode.')
  const user = users.results[0].id
  const adminRole = `${input.tenant}:tenant-administrator`
  const siteRole = `${input.tenant}:site-administrator`
  const guard = crypto.randomUUID()
  // Repeated preparation retains settings, role definitions and credentials.
  await database.batch([
    database.prepare('UPDATE vc_site_websites SET initialized=1,published=1,revision=revision+1 WHERE site_id=?').bind(input.site),
    database
      .prepare(
        'INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES(?,?,1) ON CONFLICT(tenant_id,user_id) DO NOTHING',
      )
      .bind(input.tenant, user),
    database
      .prepare(
        "INSERT INTO vc_tenant_roles(id,tenant_id,name,description,builtin) VALUES(?,?, 'Tenant Administrator','Manages this tenant and can read its private content.','tenant-administrator') ON CONFLICT DO NOTHING",
      )
      .bind(adminRole, input.tenant),
    database
      .prepare(
        "INSERT INTO vc_tenant_roles(id,tenant_id,name,description,builtin) VALUES(?,?, 'Site Administrator','Manages an assigned site and explicitly delegated descendants.','site-administrator') ON CONFLICT DO NOTHING",
      )
      .bind(siteRole, input.tenant),
    database
      .prepare(
        'INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES(?,?,?,?,NULL,1) ON CONFLICT DO NOTHING',
      )
      .bind(`${input.tenant}:bootstrap-administrator`, input.tenant, user, adminRole),
    ...applicationFeatures.map((feature) =>
      database
        .prepare(
          'INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES(?,?,1) ON CONFLICT DO NOTHING',
        )
        .bind(input.tenant, feature),
    ),
    database
      .prepare(
        "INSERT INTO vc_scoped_settings(tenant_id,scope,site_id,value) VALUES(?,'tenant',NULL,?) ON CONFLICT DO NOTHING",
      )
      .bind(input.tenant, JSON.stringify(tenantSettingDefaults)),
    database
      .prepare(
        'INSERT INTO vc_scoped_settings(tenant_id,scope,site_id,value) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
      )
      .bind(input.tenant, `site:${input.site}`, input.site, JSON.stringify(siteSettingDefaults)),
    database
      .prepare(
        'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_active_tenant_administrators WHERE tenant_id=? AND user_id=?',
      )
      .bind(guard, input.tenant, user),
    database.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
  ])
  const administrator = await database
    .prepare('SELECT user_id FROM vc_active_tenant_administrators WHERE tenant_id=? AND user_id=?')
    .bind(input.tenant, user)
    .first()
  if (!administrator)
    throw Error('Bootstrap did not produce the intended active Tenant Administrator.')
  return { tenant: input.tenant, site: input.site, administrator: user }
}

/** Call only after the complete application runtime and installer validation pass. */
export async function activateTenantAuthority(database: D1Database, tenant: string) {
  const guard = crypto.randomUUID()
  await database.batch([
    database
      .prepare(
        `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN
      EXISTS(SELECT 1 FROM vc_active_tenant_administrators WHERE tenant_id=?) AND
      (SELECT count(*) FROM vc_tenant_features WHERE tenant_id=? AND feature IN(${applicationFeatures.map(() => '?').join(',')}))=? AND
      EXISTS(SELECT 1 FROM vc_scoped_settings WHERE tenant_id=? AND scope='tenant') AND
      EXISTS(SELECT 1 FROM vc_sites s JOIN vc_scoped_settings v ON v.site_id=s.id AND v.tenant_id=s.organization_id WHERE s.organization_id=? AND s.parent_id IS NULL)
      THEN 1 ELSE 0 END`,
      )
      .bind(
        guard,
        tenant,
        tenant,
        ...applicationFeatures,
        applicationFeatures.length,
        tenant,
        tenant,
      ),
    database
      .prepare(
        'INSERT INTO vc_tenant_installation(tenant_id,model_version,activated_at) VALUES(?,1,?) ON CONFLICT DO NOTHING',
      )
      .bind(tenant, new Date().toISOString()),
    database
      .prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=?')
      .bind(tenant),
    database.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
  ])
}
