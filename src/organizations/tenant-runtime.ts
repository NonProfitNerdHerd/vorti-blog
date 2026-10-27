import { TenantRepository } from './tenant-repository'
import {
  applicationFeatures,
  crmPermissionCategories,
  permissions,
  type Permission,
  type ApplicationFeature,
} from './permission-catalog'
import { effectiveFeature, evaluateTenantPermission } from './tenant-policy'
import {
  informationCategories,
  siteOperations,
  type InformationCategory,
  type SiteOperation,
  type AuthorityDecision,
} from './policy'

const installed = new WeakSet<D1Database>()
export async function tenantSchemaInstalled(db: D1Database) {
  if (installed.has(db)) return true
  const exists = !!(await db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_tenant_installation'")
    .first())
  if (exists) installed.add(db)
  return exists
}
export async function tenantAuthorityActive(db: D1Database, site?: string) {
  if (!(await tenantSchemaInstalled(db))) return false
  return !!(await (
    site
      ? db
          .prepare(
            'SELECT 1 FROM vc_tenant_installation i JOIN vc_sites s ON s.organization_id=i.tenant_id WHERE s.id=?',
          )
          .bind(site)
      : db.prepare('SELECT 1 FROM vc_tenant_installation LIMIT 1')
  ).first())
}

export async function featureAvailableAt(
  db: D1Database,
  site: string,
  feature: ApplicationFeature,
): Promise<boolean> {
  if (!(await tenantAuthorityActive(db, site))) return true
  const row = await db
    .prepare(
      `SELECT f.available,
    COALESCE((SELECT v.value FROM vc_site_features v JOIN vc_site_ancestry a ON a.ancestor_id=v.site_id
      WHERE a.descendant_id=s.id AND v.feature=? AND v.value<>'inherit' ORDER BY a.distance LIMIT 1),'enabled') AS effective
    FROM vc_sites s JOIN vc_tenant_features f ON f.tenant_id=s.organization_id AND f.feature=?
    WHERE s.id=? AND s.archived=0 AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites p ON p.id=a.ancestor_id WHERE a.descendant_id=s.id AND p.archived=1)`,
    )
    .bind(feature, feature, site)
    .first<{ available: number; effective: string }>()
  return row?.available === 1 && row.effective === 'enabled'
}

/** Compatibility categories are only a preliminary gate. Native operations also check
 * their exact resource/action permission before reading or mutating records. */
export function categoryPermissions(
  category: InformationCategory,
  operation: SiteOperation,
): Permission[] {
  const prefix =
    category === 'content'
      ? ['pages:', 'posts:', 'administration:']
      : category === 'workspace'
        ? ['tasks:']
        : category === 'forms' || category === 'form-submissions'
          ? ['forms:']
          : ['crm:']
  if (category === 'identity' && operation === 'configure')
    return [
      'administration:assignments',
      'administration:tenant-administrators',
      'administration:subsites',
    ]
  return permissions.filter((permission) => {
    if (!prefix.some((value) => permission.startsWith(value))) return false
    const action = permission.split(':')[1]
    // Category toggles narrow the independent CRM action grant; they never
    // substitute for create/edit/export/read authority on their own.
    if (permission.startsWith('crm:') && /^(read|edit|export)-/.test(action)) return false
    if (permission.startsWith('administration:')) {
      if (operation === 'read' || operation === 'configure') return true
      if (operation === 'edit') return ['media', 'categories', 'tags', 'menus', 'designs', 'templates', 'saved-views', 'redirects'].includes(action)
      if (operation === 'publish') return ['designs', 'templates', 'menus', 'website-publication'].includes(action)
      return false
    }
    if (operation === 'read') return action.startsWith('read')
    if (operation === 'publish') return action === 'publish'
    if (operation === 'export') return action === 'export'
    if (operation === 'configure')
      return action.startsWith('configure') || action === 'manage-projects'
    if (category === 'form-submissions')
      return ['update-submissions', 'delete-submissions'].includes(action)
    return [
      'create',
      'edit',
      'delete',
      'archive',
      'comment',
      'assign',
      'merge',
      'import',
      'share',
      'manage-projects',
    ].includes(action)
  })
}

export async function tenantAuthorityMatrix(db: D1Database, actor: number, site: string) {
  const repo = new TenantRepository(db, actor)
  const snapshot = await repo.snapshot(site)
  const fine: Permission[] = []
  for (const permission of permissions) {
    const resource = permission.split(':')[0] as ApplicationFeature
    const available =
      !applicationFeatures.includes(resource) ||
      effectiveFeature(snapshot.features, site, resource).available
    if (
      evaluateTenantPermission(snapshot.policy, { site, permission, featureAvailable: available })
        .allowed
    )
      fine.push(permission)
  }
  const denied = (
    await db
      .prepare(
        `SELECT DISTINCT r.category,r.operation FROM vc_member_restrictions r
    JOIN vc_site_ancestry a ON a.ancestor_id=r.site_id WHERE a.descendant_id=? AND r.user_id=?`,
      )
      .bind(site, actor)
      .all<{ category: InformationCategory; operation: SiteOperation }>()
  ).results
  const administrator = evaluateTenantPermission(snapshot.policy, {
    site,
    permission: 'administration:read-audit',
    featureAvailable: true,
  }).auditAdministratorRead
  const allowed: Partial<Record<InformationCategory, SiteOperation[]>> = {}
  const decisions: Array<
    AuthorityDecision & { category: InformationCategory; operation: SiteOperation }
  > = []
  for (const category of informationCategories)
    for (const operation of siteOperations) {
      const crmCategory = crmPermissionCategories.some(value => value === category)
      const categoryGrant = `crm:${operation === 'read' ? 'read' : operation === 'export' ? 'export' : 'edit'}-${category}` as Permission
      const permitted =
        categoryPermissions(category, operation).some((permission) => fine.includes(permission)) &&
        (!crmCategory || fine.includes(categoryGrant)) &&
        ((administrator && operation === 'read') ||
          !denied.some((item) => item.category === category && item.operation === operation))
      if (permitted) (allowed[category] ||= []).push(operation)
      decisions.push({
        category,
        operation,
        allowed: permitted,
        reason: permitted ? 'tenant-role' : 'no-grant',
      })
    }
  await repo.assertRevision(snapshot.policy.tenant, snapshot.revision)
  return {
    allowed,
    decisions,
    authorityRevision: snapshot.revision,
    operator: false,
    tenantAdministrator: administrator,
    permissions: fine,
  }
}
