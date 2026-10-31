import { atomicSiteMutation, SiteConflictError } from './atomic'
import {
  applicationFeatures,
  isPermission,
  permissions,
  readPermissions,
  type ApplicationFeature,
  type Permission,
} from './permission-catalog'
import {
  effectiveFeature,
  canDelegate,
  evaluateTenantPermission,
  type FeaturePolicy,
  type TenantPolicy,
  type TenantRole,
} from './tenant-policy'

export class TenantPermissionError extends Error {
  readonly status = 403
  constructor() {
    super('This resource is unavailable or your permissions changed.')
  }
}
/** No caller-supplied claims, role names, or administrator flags are accepted. */
export class TenantRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
  ) {
    if (!Number.isSafeInteger(actor) || actor < 1) throw new TenantPermissionError()
  }

  async snapshot(
    site: string,
  ): Promise<{ policy: TenantPolicy; features: FeaturePolicy; revision: number }> {
    const scope = await this.db
      .prepare(
        `SELECT o.id,o.authority_revision FROM vc_sites s
      JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=?`,
      )
      .bind(site)
      .first<{ id: string; authority_revision: number }>()
    if (!scope) throw new TenantPermissionError()
    const tenant = scope.id
    const [member, sites, roles, grants, assignments, denied, features, overrides] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT m.active,NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=m.user_id AND s.disabled=1) AS account_active
        FROM vc_tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=?`,
          )
          .bind(tenant, this.actor)
          .first<{ active: number; account_active: number }>(),
        this.db
          .prepare(
            'SELECT id,organization_id,parent_id,archived FROM vc_sites WHERE organization_id=?',
          )
          .bind(tenant)
          .all<{
            id: string
            organization_id: string
            parent_id: string | null
            archived: number
          }>(),
        this.db
          .prepare('SELECT id,tenant_id,builtin,retired FROM vc_tenant_roles WHERE tenant_id=?')
          .bind(tenant)
          .all<{
            id: string
            tenant_id: string
            builtin: TenantRole['builtin']
            retired: number
          }>(),
        this.db
          .prepare(
            'SELECT p.role_id,p.permission FROM vc_tenant_role_permissions p JOIN vc_tenant_roles r ON r.id=p.role_id WHERE r.tenant_id=?',
          )
          .bind(tenant)
          .all<{ role_id: string; permission: string }>(),
        this.db
          .prepare(
            'SELECT role_id,site_id,descendants FROM vc_tenant_assignments WHERE tenant_id=? AND user_id=?',
          )
          .bind(tenant, this.actor)
          .all<{ role_id: string; site_id: string | null; descendants: number }>(),
        this.db
          .prepare('SELECT permission FROM vc_tenant_restrictions WHERE tenant_id=? AND user_id=?')
          .bind(tenant, this.actor)
          .all<{ permission: string }>(),
        this.db
          .prepare('SELECT feature,available FROM vc_tenant_features WHERE tenant_id=?')
          .bind(tenant)
          .all<{ feature: ApplicationFeature; available: number }>(),
        this.db
          .prepare(
            'SELECT f.site_id,f.feature,f.value FROM vc_site_features f JOIN vc_sites s ON s.id=f.site_id WHERE s.organization_id=?',
          )
          .bind(tenant)
          .all<{
            site_id: string
            feature: ApplicationFeature
            value: 'inherit' | 'enabled' | 'disabled'
          }>(),
      ])
    if (
      grants.results.some((row) => !isPermission(row.permission)) ||
      denied.results.some((row) => !isPermission(row.permission))
    )
      throw new TenantPermissionError()
    const nodes = sites.results.map((row) => ({
      id: row.id,
      organization: row.organization_id,
      parent: row.parent_id,
      archived: row.archived === 1,
    }))
    const policy: TenantPolicy = {
      tenant,
      accountActive: member?.account_active === 1,
      membershipActive: member?.active === 1,
      sites: nodes,
      roles: roles.results.map((row) => ({
        id: row.id,
        tenant: row.tenant_id,
        builtin: row.builtin,
        retired: row.retired === 1,
        permissions: row.builtin
          ? permissions.filter(
              (permission) =>
                row.builtin === 'tenant-administrator' ||
                ![
                  'administration:tenant-administrators',
                  'wiki:read-private',
                  'forms:read-sensitive',
                  'crm:read-restricted-activity',
                  'crm:edit-restricted-activity',
                  'crm:export-restricted-activity',
                ].includes(permission),
            )
          : grants.results
              .filter((grant) => grant.role_id === row.id)
              .map((grant) => grant.permission as Permission),
      })),
      assignments: assignments.results.map((row) => ({
        role: row.role_id,
        site: row.site_id,
        descendants: row.descendants === 1,
      })),
      denied: denied.results.map((row) => row.permission as Permission),
    }
    // Missing installation seeds fail closed, rather than silently activating a module.
    const available = Object.fromEntries(
      applicationFeatures.map((feature) => [
        feature,
        features.results.find((row) => row.feature === feature)?.available === 1,
      ]),
    ) as FeaturePolicy['available']
    await this.assertRevision(tenant, scope.authority_revision)
    return {
      policy,
      features: {
        tenant,
        sites: nodes,
        available,
        overrides: overrides.results.map((row) => ({
          site: row.site_id,
          feature: row.feature,
          value: row.value,
        })),
      },
      revision: scope.authority_revision,
    }
  }

  async assertRevision(tenant: string, revision: number) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(tenant)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== revision) throw new SiteConflictError()
  }

  private async mutate(input: {
    tenant: string
    revision: number
    key: string
    action: string
    record: string
    value: unknown
    statements: D1PreparedStatement[]
  }) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify({
          tenant: input.tenant,
          revision: input.revision,
          action: input.action,
          record: input.record,
          value: input.value,
        }),
      ),
    )
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.key,
      fingerprint,
      write: this.db
        .prepare(
          'UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=? AND authority_revision=?',
        )
        .bind(input.tenant, input.revision),
      afterWrite: [
        ...input.statements,
        this.db
          .prepare(
            `INSERT INTO vc_platform_audit
        (id,organization_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.tenant,
            this.actor,
            input.action,
            'tenant-authority',
            input.record,
            JSON.stringify(input.value),
            input.key,
            new Date().toISOString(),
          ),
      ],
      result: { id: input.record },
    })
  }

  async saveRole(input: {
    site: string
    id: string
    expectedAuthorityRevision: number
    key: string
    name: string
    description: string
    permissions: Permission[]
  }) {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ||
      !input.name.trim() ||
      input.name.length > 120 ||
      input.description.length > 2000 ||
      !Array.isArray(input.permissions) ||
      input.permissions.some((permission) => !isPermission(permission))
    )
      throw Error('Invalid role definition.')
    const snapshot = await this.snapshot(input.site)
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    if (
      !evaluateTenantPermission(snapshot.policy, {
        site: input.site,
        permission: 'administration:roles',
        featureAvailable: true,
      }).allowed
    )
      throw new TenantPermissionError()
    const current = await this.db
      .prepare('SELECT tenant_id,builtin FROM vc_tenant_roles WHERE id=?')
      .bind(input.id)
      .first<{ tenant_id: string; builtin: string | null }>()
    if (current && (current.tenant_id !== snapshot.policy.tenant || current.builtin))
      throw new TenantPermissionError()
    const scopes = await this.db
      .prepare('SELECT site_id,descendants FROM vc_tenant_assignments WHERE role_id=?')
      .bind(input.id)
      .all<{ site_id: string | null; descendants: number }>()
    const rolePermissions = [...new Set(input.permissions)].sort()
    // Editing a shared role must be valid everywhere it is already assigned.
    const destinations = scopes.results.length
      ? scopes.results
      : [{ site_id: input.site, descendants: 0 }]
    if (
      !destinations.every((scope) =>
        canDelegate(snapshot.policy, {
          site: scope.site_id,
          descendants: scope.descendants === 1,
          permissions: [...rolePermissions, 'administration:roles'],
        }),
      )
    )
      throw new TenantPermissionError()
    const value = {
      name: input.name.trim(),
      description: input.description,
      permissions: rolePermissions,
    }
    return this.mutate({
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      key: input.key,
      action: 'role.saved',
      record: input.id,
      value,
      statements: [
        this.db
          .prepare(
            `INSERT INTO vc_tenant_roles(id,tenant_id,name,description) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,revision=vc_tenant_roles.revision+1`,
          )
          .bind(input.id, snapshot.policy.tenant, value.name, value.description),
        this.db.prepare('DELETE FROM vc_tenant_role_permissions WHERE role_id=?').bind(input.id),
        ...rolePermissions.map((permission) =>
          this.db
            .prepare('INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES(?,?)')
            .bind(input.id, permission),
        ),
      ],
    })
  }

  async retireRole(input: {
    site: string
    id: string
    expectedAuthorityRevision: number
    key: string
  }) {
    const authority = await this.require(input.site, 'administration:roles')
    if (authority.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    const role = await this.db
      .prepare('SELECT builtin FROM vc_tenant_roles WHERE id=? AND tenant_id=?')
      .bind(input.id, authority.tenant)
      .first<{ builtin: string | null }>()
    if (!role || role.builtin) throw new TenantPermissionError()
    const snapshot = await this.snapshot(input.site)
    if (snapshot.revision !== authority.revision) throw new SiteConflictError()
    const assignments = await this.db
      .prepare('SELECT site_id,descendants FROM vc_tenant_assignments WHERE role_id=?')
      .bind(input.id)
      .all<{ site_id: string | null; descendants: number }>()
    if (
      !assignments.results.every((scope) =>
        canDelegate(snapshot.policy, {
          site: scope.site_id,
          descendants: scope.descendants === 1,
          permissions: ['administration:roles'],
        }),
      )
    )
      throw new TenantPermissionError()
    return this.mutate({
      tenant: authority.tenant,
      revision: authority.revision,
      key: input.key,
      action: 'role.retired',
      record: input.id,
      value: { retired: true },
      statements: [
        this.db
          .prepare(
            'UPDATE vc_tenant_roles SET retired=1,revision=revision+1 WHERE id=? AND tenant_id=?',
          )
          .bind(input.id, authority.tenant),
      ],
    })
  }

  async assignRole(input: {
    contextSite: string
    id: string
    user: number
    role: string
    site: string | null
    descendants: boolean
    expectedAuthorityRevision: number
    key: string
  }) {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ||
      !Number.isSafeInteger(input.user) ||
      input.user < 1
    )
      throw Error('Invalid role assignment.')
    const snapshot = await this.snapshot(input.contextSite)
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    const role = snapshot.policy.roles.find((role) => role.id === input.role)
    if (!role || role.retired) throw new TenantPermissionError()
    const permission =
      role.builtin === 'tenant-administrator'
        ? 'administration:tenant-administrators'
        : 'administration:assignments'
    if (
      !evaluateTenantPermission(snapshot.policy, {
        site: input.contextSite,
        permission,
        featureAvailable: true,
      }).allowed ||
      !canDelegate(snapshot.policy, {
        site: input.site,
        descendants: input.descendants,
        permissions: [...role.permissions, permission],
      })
    )
      throw new TenantPermissionError()
    const existing = await this.db
      .prepare('SELECT id FROM vc_tenant_assignments WHERE id=?')
      .bind(input.id)
      .first()
    if (existing) throw new SiteConflictError()
    return this.mutate({
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      key: input.key,
      action: 'role.assigned',
      record: input.id,
      value: {
        user: input.user,
        role: input.role,
        site: input.site,
        descendants: input.descendants,
      },
      statements: [
        this.db
          .prepare(
            'INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            input.id,
            snapshot.policy.tenant,
            input.user,
            input.role,
            input.site,
            input.descendants ? 1 : 0,
          ),
      ],
    })
  }

  async removeAssignment(input: {
    contextSite: string
    id: string
    expectedAuthorityRevision: number
    key: string
  }) {
    const snapshot = await this.snapshot(input.contextSite)
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    const assignment = await this.db
      .prepare(
        'SELECT role_id,site_id,descendants FROM vc_tenant_assignments WHERE id=? AND tenant_id=?',
      )
      .bind(input.id, snapshot.policy.tenant)
      .first<{ role_id: string; site_id: string | null; descendants: number }>()
    const role = snapshot.policy.roles.find((role) => role.id === assignment?.role_id)
    if (!assignment || !role) throw new TenantPermissionError()
    const permission =
      role.builtin === 'tenant-administrator'
        ? 'administration:tenant-administrators'
        : 'administration:assignments'
    if (
      !canDelegate(snapshot.policy, {
        site: assignment.site_id,
        descendants: assignment.descendants === 1,
        permissions: [permission],
      })
    )
      throw new TenantPermissionError()
    return this.mutate({
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      key: input.key,
      action: 'role.unassigned',
      record: input.id,
      value: { role: role.id },
      statements: [
        this.db
          .prepare('DELETE FROM vc_tenant_assignments WHERE id=? AND tenant_id=?')
          .bind(input.id, snapshot.policy.tenant),
      ],
    })
  }

  async setMemberActive(input: {
    contextSite: string
    user: number
    active: boolean
    expectedAuthorityRevision: number
    key: string
  }) {
    if (!Number.isSafeInteger(input.user) || input.user < 1 || typeof input.active !== 'boolean')
      throw Error('Invalid tenant member.')
    const snapshot = await this.snapshot(input.contextSite)
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    if (
      !canDelegate(snapshot.policy, {
        site: null,
        descendants: true,
        permissions: ['administration:tenant-administrators'],
      })
    )
      throw new TenantPermissionError()
    if (
      !(await this.db
        .prepare('SELECT user_id FROM vc_tenant_memberships WHERE tenant_id=? AND user_id=?')
        .bind(snapshot.policy.tenant, input.user)
        .first())
    )
      throw new TenantPermissionError()
    return this.mutate({
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      key: input.key,
      action: 'membership.status',
      record: String(input.user),
      value: { active: input.active },
      statements: [
        this.db
          .prepare(
            'UPDATE vc_tenant_memberships SET active=?,revision=revision+1 WHERE tenant_id=? AND user_id=?',
          )
          .bind(input.active ? 1 : 0, snapshot.policy.tenant, input.user),
      ],
    })
  }

  async setFeature(input: {
    contextSite: string
    site: string | null
    feature: ApplicationFeature
    value: boolean | 'inherit' | 'enabled' | 'disabled'
    expectedAuthorityRevision: number
    key: string
  }) {
    if (
      !applicationFeatures.includes(input.feature) ||
      (input.site === null
        ? typeof input.value !== 'boolean'
        : !['inherit', 'enabled', 'disabled'].includes(String(input.value)))
    )
      throw Error('Invalid feature setting.')
    const snapshot = await this.snapshot(input.contextSite)
    if (snapshot.revision !== input.expectedAuthorityRevision) throw new SiteConflictError()
    if (
      !canDelegate(snapshot.policy, {
        site: input.site,
        descendants: false,
        permissions: ['administration:features'],
      })
    )
      throw new TenantPermissionError()
    if (input.feature === 'tasks' && (input.value === false || input.value === 'disabled')) {
      const affects = input.site === null ? snapshot.features.available.crm : snapshot.features.sites.some((node) => {
        let current = node
        while (current && current.id !== input.site && current.parent) {
          const parent = snapshot.features.sites.find((site) => site.id === current.parent)
          if (!parent) break
          current = parent
        }
        return current.id === input.site && effectiveFeature(snapshot.features, node.id, 'crm').available
      })
      if (affects) throw new TenantPermissionError()
    }
    const statement =
      input.site === null
        ? this.db
            .prepare(
              `INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES(?,?,?)
      ON CONFLICT(tenant_id,feature) DO UPDATE SET available=excluded.available,revision=vc_tenant_features.revision+1`,
            )
            .bind(snapshot.policy.tenant, input.feature, input.value ? 1 : 0)
        : this.db
            .prepare(
              `INSERT INTO vc_site_features(site_id,feature,value) VALUES(?,?,?) ON CONFLICT(site_id,feature)
        DO UPDATE SET value=excluded.value,revision=vc_site_features.revision+1`,
            )
            .bind(input.site, input.feature, String(input.value))
    const enablingCRM = input.feature === 'crm' && (input.value === true || input.value === 'enabled')
    if (enablingCRM && input.site !== null && !snapshot.features.available.tasks &&
      !canDelegate(snapshot.policy, { site: null, descendants: false, permissions: ['administration:features'] }))
      throw new TenantPermissionError()
    const statements = [statement]
    if (enablingCRM) {
      if (input.site === null || !snapshot.features.available.tasks)
        statements.push(this.db.prepare(`INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES(?,'tasks',1) ON CONFLICT(tenant_id,feature) DO UPDATE SET available=1,revision=vc_tenant_features.revision+1`).bind(snapshot.policy.tenant))
      if (input.site !== null)
        statements.push(this.db.prepare(`INSERT INTO vc_site_features(site_id,feature,value) VALUES(?,'tasks','enabled') ON CONFLICT(site_id,feature) DO UPDATE SET value='enabled',revision=vc_site_features.revision+1`).bind(input.site))
    }
    return this.mutate({
      tenant: snapshot.policy.tenant,
      revision: snapshot.revision,
      key: input.key,
      action: 'feature.configured',
      record: `${input.site ?? snapshot.policy.tenant}:${input.feature}`,
      value: { configured: input.value },
      statements,
    })
  }

  /** Audit the actual read scope, not a permission probe used to draw navigation. */
  async read<T>(
    input: {
      site: string
      permission: Permission
      resource: string
      privateRecord?: boolean
      recordAccess?: boolean
      dependencies?: ApplicationFeature[]
    },
    fetch: () => Promise<T>,
  ): Promise<T> {
    if (!readPermissions.has(input.permission) || !input.resource || input.resource.length > 500)
      throw new TenantPermissionError()
    const authority = await this.require(input.site, input.permission, input)
    if (authority.auditAdministratorRead) {
      const key = crypto.randomUUID()
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?`,
          )
          .bind(key, authority.tenant, authority.revision),
        this.db
          .prepare(
            `INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,operation_key,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            key,
            authority.tenant,
            input.site,
            this.actor,
            'tenant-administrator.read',
            input.permission,
            input.resource,
            key,
            new Date().toISOString(),
          ),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
      ])
    }
    const result = await fetch()
    await this.assertRevision(authority.tenant, authority.revision)
    return result
  }

  async require(
    site: string,
    permission: Permission,
    options: {
      privateRecord?: boolean
      recordAccess?: boolean
      dependencies?: ApplicationFeature[]
    } = {},
  ) {
    const snapshot = await this.snapshot(site)
    const resource = permission.split(':')[0]
    const features = [
      ...(applicationFeatures.includes(resource as ApplicationFeature)
        ? [resource as ApplicationFeature]
        : []),
      ...(options.dependencies ?? []),
    ]
    const decision = evaluateTenantPermission(snapshot.policy, {
      site,
      permission,
      privateRecord: options.privateRecord,
      recordAccess: options.recordAccess,
      featureAvailable: features.every(
        (feature) => effectiveFeature(snapshot.features, site, feature).available,
      ),
    })
    if (!decision.allowed) throw new TenantPermissionError()
    // The consuming read must record administrator access with its actual resource identity
    // before returning content, then confirm the revision again after fetching it.
    return { ...decision, tenant: snapshot.policy.tenant, revision: snapshot.revision }
  }
}
