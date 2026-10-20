/** Frozen organization foundation migration v1. Future schema changes belong in new migrations.
 * CRM constituents must not be stored in vc_organizations.
 */
export const organizationSchema = [
  `CREATE TABLE IF NOT EXISTS vc_organizations (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    authority_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vc_sites (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    parent_id TEXT REFERENCES vc_sites(id), name TEXT NOT NULL, route_key TEXT NOT NULL UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
    settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(id,organization_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_sites_root_idx ON vc_sites(organization_id) WHERE parent_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS vc_sites_parent_idx ON vc_sites(organization_id,parent_id,archived)`,
  `CREATE TABLE IF NOT EXISTS vc_site_ancestry (
    ancestor_id TEXT NOT NULL REFERENCES vc_sites(id), descendant_id TEXT NOT NULL REFERENCES vc_sites(id),
    distance INTEGER NOT NULL CHECK(distance>=0), PRIMARY KEY(ancestor_id,descendant_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_site_ancestry_descendant_idx ON vc_site_ancestry(descendant_id,distance)`,
  `CREATE TABLE IF NOT EXISTS vc_site_memberships (
    site_id TEXT NOT NULL REFERENCES vc_sites(id), user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('administrator','editor','reader')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(site_id,user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_site_memberships_user_idx ON vc_site_memberships(user_id,active,site_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_membership_authority_insert AFTER INSERT ON vc_site_memberships BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=NEW.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_membership_authority_update AFTER UPDATE ON vc_site_memberships BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id IN(SELECT organization_id FROM vc_sites WHERE id IN(NEW.site_id,OLD.site_id)); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_membership_authority_delete AFTER DELETE ON vc_site_memberships BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=OLD.site_id); END`,
  `CREATE TABLE IF NOT EXISTS vc_installation_operators (
    user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_operator_authority_insert AFTER INSERT ON vc_installation_operators BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_operator_authority_delete AFTER DELETE ON vc_installation_operators BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_operator_authority_update AFTER UPDATE ON vc_installation_operators BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
  `CREATE TABLE IF NOT EXISTS vc_site_policies (
    site_id TEXT NOT NULL REFERENCES vc_sites(id), category TEXT NOT NULL, operation TEXT NOT NULL,
    descendants_allowed INTEGER NOT NULL CHECK(descendants_allowed IN(0,1)),
    oversee_descendants INTEGER NOT NULL CHECK(oversee_descendants IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(site_id,category,operation)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_site_grants (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES vc_organizations(id),
    source_id TEXT NOT NULL REFERENCES vc_sites(id), receiver_id TEXT NOT NULL REFERENCES vc_sites(id),
    receiver_descendants INTEGER NOT NULL CHECK(receiver_descendants IN(0,1)), category TEXT NOT NULL,
    operation TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_site_grants_source_idx ON vc_site_grants(source_id,category,operation,revoked)`,
  `CREATE INDEX IF NOT EXISTS vc_site_grants_receiver_idx ON vc_site_grants(receiver_id,revoked)`,
  `CREATE TABLE IF NOT EXISTS vc_site_contexts (
    user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id), site_id TEXT NOT NULL REFERENCES vc_sites(id),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_policy_authority_insert AFTER INSERT ON vc_site_policies BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=NEW.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_policy_authority_update AFTER UPDATE ON vc_site_policies BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=NEW.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_policy_authority_delete AFTER DELETE ON vc_site_policies BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=OLD.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_grant_authority_insert AFTER INSERT ON vc_site_grants BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=NEW.organization_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_grant_authority_update AFTER UPDATE ON vc_site_grants BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id IN(NEW.organization_id,OLD.organization_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_grant_authority_delete AFTER DELETE ON vc_site_grants BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=OLD.organization_id; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_site_authority_update AFTER UPDATE OF parent_id,archived ON vc_sites BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=NEW.organization_id; END`,
  `CREATE TABLE IF NOT EXISTS vc_site_hosts (
    hostname TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    verified_at TEXT, revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS vc_platform_audit (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT REFERENCES vc_organizations(id),
    site_id TEXT REFERENCES vc_sites(id), actor_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL,
    before_value TEXT, after_value TEXT, reason TEXT, operation_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_platform_audit_site_idx ON vc_platform_audit(site_id,created_at,id)`,
  `CREATE TABLE IF NOT EXISTS vc_platform_operations (
    operation_key TEXT PRIMARY KEY NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id),
    fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  // The CHECK constraint turns a failed optimistic update into a batch rollback.
  `CREATE TABLE IF NOT EXISTS vc_write_guards (
    operation_key TEXT PRIMARY KEY NOT NULL, affected INTEGER NOT NULL CHECK(affected=1)
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_sites_parent_insert BEFORE INSERT ON vc_sites
    WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_sites p WHERE p.id=NEW.parent_id AND p.organization_id=NEW.organization_id)
    BEGIN SELECT RAISE(ABORT,'Invalid parent organization'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_sites_parent_update BEFORE UPDATE OF parent_id,organization_id ON vc_sites
    WHEN NEW.organization_id<>OLD.organization_id OR (OLD.parent_id IS NULL AND NEW.parent_id IS NOT NULL)
      OR (OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL)
      OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_sites p WHERE p.id=NEW.parent_id AND p.organization_id=NEW.organization_id))
      OR NEW.parent_id=NEW.id
      OR EXISTS(WITH RECURSIVE parents(id) AS (SELECT NEW.parent_id UNION SELECT s.parent_id FROM vc_sites s JOIN parents p ON s.id=p.id WHERE s.parent_id IS NOT NULL) SELECT 1 FROM parents WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Invalid site move'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_platform_audit_no_update BEFORE UPDATE ON vc_platform_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_platform_audit_no_delete BEFORE DELETE ON vc_platform_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END`,
] as const

/** Deterministic compatibility mappings; never claim personal Tasks for a site. */
export const defaultOrganizationSeed = [
  `INSERT OR IGNORE INTO vc_organizations(id,name,created_at,updated_at) VALUES('default','Default organization',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `INSERT OR IGNORE INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES('default','default',NULL,'Main site','default',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `INSERT OR IGNORE INTO vc_site_ancestry(ancestor_id,descendant_id,distance) VALUES('default','default',0)`,
  `INSERT OR IGNORE INTO vc_installation_operators(user_id,created_at) SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE role='administrator'`,
  `INSERT OR IGNORE INTO vc_site_memberships(site_id,user_id,role) SELECT 'default',id,CASE WHEN role='administrator' THEN 'administrator' WHEN role='designer' THEN 'editor' ELSE 'reader' END FROM users`,
] as const
