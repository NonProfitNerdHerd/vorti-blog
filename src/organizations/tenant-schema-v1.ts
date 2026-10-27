/** Additive tenant authority model. Built-ins are installed explicitly by the installer. */
export const tenantSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_tenant_installation (
    tenant_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_organizations(id),
    model_version INTEGER NOT NULL CHECK(model_version=1), activated_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_tenant_installation_immutable_update BEFORE UPDATE ON vc_tenant_installation
    BEGIN SELECT RAISE(ABORT,'Tenant authority cannot be disabled'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_tenant_installation_immutable_delete BEFORE DELETE ON vc_tenant_installation
    BEGIN SELECT RAISE(ABORT,'Tenant authority cannot be disabled'); END`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_memberships (
    tenant_id TEXT NOT NULL REFERENCES vc_organizations(id), user_id INTEGER NOT NULL REFERENCES users(id),
    active INTEGER NOT NULL CHECK(active IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(tenant_id,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_roles (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES vc_organizations(id), name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', builtin TEXT CHECK(builtin IN('tenant-administrator','site-administrator')),
    retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(id,tenant_id), UNIQUE(tenant_id,builtin), CHECK(builtin IS NULL OR retired=0)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_role_permissions (
    role_id TEXT NOT NULL REFERENCES vc_tenant_roles(id), permission TEXT NOT NULL, PRIMARY KEY(role_id,permission)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_assignments (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, user_id INTEGER NOT NULL, role_id TEXT NOT NULL,
    site_id TEXT, descendants INTEGER NOT NULL CHECK(descendants IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(tenant_id,user_id) REFERENCES vc_tenant_memberships(tenant_id,user_id),
    FOREIGN KEY(role_id,tenant_id) REFERENCES vc_tenant_roles(id,tenant_id),
    FOREIGN KEY(site_id,tenant_id) REFERENCES vc_sites(id,organization_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_tenant_assignments_scope ON vc_tenant_assignments(tenant_id,user_id,role_id,ifnull(site_id,''))`,
  `CREATE VIEW IF NOT EXISTS vc_tenant_user_sites AS
    SELECT DISTINCT CAST(m.user_id AS TEXT)||':'||s.id AS id,m.user_id,s.id AS site,1 AS enabled
    FROM vc_tenant_memberships m JOIN vc_sites s ON s.organization_id=m.tenant_id
    JOIN vc_tenant_assignments a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id
    JOIN vc_tenant_roles r ON r.id=a.role_id
    WHERE m.active=1 AND r.retired=0 AND s.archived=0
      AND (a.site_id IS NULL OR a.site_id=s.id OR (a.descendants=1 AND EXISTS(SELECT 1 FROM vc_site_ancestry n WHERE n.ancestor_id=a.site_id AND n.descendant_id=s.id)))
      AND NOT EXISTS(SELECT 1 FROM vc_account_status status WHERE status.user_id=m.user_id AND status.disabled=1)
      AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry n JOIN vc_sites ancestor ON ancestor.id=n.ancestor_id WHERE n.descendant_id=s.id AND ancestor.archived=1)`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_restrictions (
    tenant_id TEXT NOT NULL,user_id INTEGER NOT NULL,permission TEXT NOT NULL,
    PRIMARY KEY(tenant_id,user_id,permission),
    FOREIGN KEY(tenant_id,user_id) REFERENCES vc_tenant_memberships(tenant_id,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_tenant_features (
    tenant_id TEXT NOT NULL REFERENCES vc_organizations(id), feature TEXT NOT NULL,
    available INTEGER NOT NULL CHECK(available IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(tenant_id,feature)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_site_features (
    site_id TEXT NOT NULL REFERENCES vc_sites(id),feature TEXT NOT NULL,
    value TEXT NOT NULL CHECK(value IN('inherit','enabled','disabled')),revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(site_id,feature)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_scoped_settings (
    tenant_id TEXT NOT NULL REFERENCES vc_organizations(id),scope TEXT NOT NULL,site_id TEXT,
    value TEXT NOT NULL CHECK(json_valid(value)),revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(tenant_id,scope), FOREIGN KEY(site_id,tenant_id) REFERENCES vc_sites(id,organization_id),
    CHECK((scope='tenant' AND site_id IS NULL) OR(scope='site:'||site_id AND site_id IS NOT NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_tenant_builtin_update BEFORE UPDATE ON vc_tenant_roles WHEN OLD.builtin IS NOT NULL OR NEW.builtin IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Built-in roles are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_tenant_builtin_delete BEFORE DELETE ON vc_tenant_roles WHEN OLD.builtin IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Built-in roles are immutable'); END`,
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (operation) => `CREATE TRIGGER IF NOT EXISTS vc_builtin_permissions_${operation.toLowerCase()}
    BEFORE ${operation} ON vc_tenant_role_permissions WHEN EXISTS(SELECT 1 FROM vc_tenant_roles WHERE builtin IS NOT NULL
      AND id IN(${operation === 'INSERT' ? 'NEW.role_id' : operation === 'DELETE' ? 'OLD.role_id' : 'OLD.role_id,NEW.role_id'}))
    BEGIN SELECT RAISE(ABORT,'Built-in permissions are defined by the application'); END`,
  ),
  ...['INSERT', 'UPDATE'].map(
    (operation) => `CREATE TRIGGER IF NOT EXISTS vc_assignment_scope_${operation.toLowerCase()}
    BEFORE ${operation} ON vc_tenant_assignments WHEN
      (SELECT retired FROM vc_tenant_roles WHERE id=NEW.role_id)=1 OR
      ((SELECT builtin FROM vc_tenant_roles WHERE id=NEW.role_id)='tenant-administrator' AND NEW.site_id IS NOT NULL) OR
      ((SELECT builtin FROM vc_tenant_roles WHERE id=NEW.role_id)='site-administrator' AND NEW.site_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'Invalid or retired role assignment'); END`,
  ),
  `CREATE VIEW IF NOT EXISTS vc_active_tenant_administrators AS
    SELECT a.id,a.tenant_id,a.user_id FROM vc_tenant_assignments a
    JOIN vc_tenant_roles r ON r.id=a.role_id AND r.tenant_id=a.tenant_id
    JOIN vc_tenant_memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
    WHERE r.builtin='tenant-administrator' AND r.retired=0 AND a.site_id IS NULL AND m.active=1
    AND NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=a.user_id AND s.disabled=1)`,
  ...['UPDATE', 'DELETE'].map(
    (
      operation,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_last_tenant_assignment_${operation.toLowerCase()}
    AFTER ${operation} ON vc_tenant_assignments WHEN
      (SELECT builtin FROM vc_tenant_roles WHERE id=OLD.role_id)='tenant-administrator'
      AND EXISTS(SELECT 1 FROM vc_tenant_memberships m WHERE m.tenant_id=OLD.tenant_id AND m.user_id=OLD.user_id AND m.active=1)
      AND NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=OLD.user_id AND s.disabled=1)
      AND NOT EXISTS(SELECT 1 FROM vc_active_tenant_administrators WHERE tenant_id=OLD.tenant_id)
    BEGIN SELECT RAISE(ABORT,'The last active Tenant Administrator must remain'); END`,
  ),
  ...['UPDATE', 'DELETE'].map(
    (
      operation,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_last_tenant_membership_${operation.toLowerCase()}
    AFTER ${operation} ON vc_tenant_memberships WHEN OLD.active=1
      AND EXISTS(SELECT 1 FROM vc_tenant_assignments a JOIN vc_tenant_roles r ON r.id=a.role_id
        WHERE a.tenant_id=OLD.tenant_id AND a.user_id=OLD.user_id AND r.builtin='tenant-administrator')
      AND NOT EXISTS(SELECT 1 FROM vc_account_status s WHERE s.user_id=OLD.user_id AND s.disabled=1)
      AND NOT EXISTS(SELECT 1 FROM vc_active_tenant_administrators WHERE tenant_id=OLD.tenant_id)
    BEGIN SELECT RAISE(ABORT,'The last active Tenant Administrator must remain'); END`,
  ),
  ...['INSERT', 'UPDATE'].map(
    (operation) => `CREATE TRIGGER IF NOT EXISTS vc_last_tenant_account_${operation.toLowerCase()}
    AFTER ${operation} ON vc_account_status WHEN NEW.disabled=1 AND EXISTS(
      SELECT 1 FROM vc_tenant_assignments a JOIN vc_tenant_roles r ON r.id=a.role_id
      JOIN vc_tenant_memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
      WHERE a.user_id=NEW.user_id AND r.builtin='tenant-administrator' AND m.active=1
      AND NOT EXISTS(SELECT 1 FROM vc_active_tenant_administrators t WHERE t.tenant_id=a.tenant_id))
    BEGIN SELECT RAISE(ABORT,'The last active Tenant Administrator must remain'); END`,
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_last_tenant_user_delete BEFORE DELETE ON users WHEN EXISTS(
    SELECT 1 FROM vc_active_tenant_administrators a WHERE a.user_id=OLD.id AND NOT EXISTS(
      SELECT 1 FROM vc_active_tenant_administrators b WHERE b.tenant_id=a.tenant_id AND b.user_id<>OLD.id))
    BEGIN SELECT RAISE(ABORT,'The last active Tenant Administrator must remain'); END`,
  ...[
    'vc_tenant_memberships',
    'vc_tenant_roles',
    'vc_tenant_assignments',
    'vc_tenant_restrictions',
    'vc_tenant_features',
    'vc_scoped_settings',
  ].flatMap((table) =>
    ['INSERT', 'UPDATE', 'DELETE'].map(
      (operation) => `CREATE TRIGGER IF NOT EXISTS ${table}_epoch_${operation.toLowerCase()}
      AFTER ${operation} ON ${table} BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1
      WHERE id IN(${operation === 'INSERT' ? 'NEW.tenant_id' : operation === 'DELETE' ? 'OLD.tenant_id' : 'OLD.tenant_id,NEW.tenant_id'}); END`,
    ),
  ),
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (
      operation,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_tenant_permissions_epoch_${operation.toLowerCase()}
    AFTER ${operation} ON vc_tenant_role_permissions BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1
    WHERE id IN(SELECT tenant_id FROM vc_tenant_roles WHERE id IN(${operation === 'INSERT' ? 'NEW.role_id' : operation === 'DELETE' ? 'OLD.role_id' : 'OLD.role_id,NEW.role_id'})); END`,
  ),
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (operation) => `CREATE TRIGGER IF NOT EXISTS vc_site_features_epoch_${operation.toLowerCase()}
    AFTER ${operation} ON vc_site_features BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1
    WHERE id IN(SELECT organization_id FROM vc_sites WHERE id IN(${operation === 'INSERT' ? 'NEW.site_id' : operation === 'DELETE' ? 'OLD.site_id' : 'OLD.site_id,NEW.site_id'})); END`,
  ),
] as const
