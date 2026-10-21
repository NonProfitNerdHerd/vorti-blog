/** Explicit per-domain capabilities; roles supply defaults, restrictions always take precedence. */
export const organizationSchemaV3 = [
  `CREATE TABLE IF NOT EXISTS vc_member_capabilities (
    site_id TEXT NOT NULL, user_id INTEGER NOT NULL, category TEXT NOT NULL, operation TEXT NOT NULL,
    PRIMARY KEY(site_id,user_id,category,operation),
    FOREIGN KEY(site_id,user_id) REFERENCES vc_site_memberships(site_id,user_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_capability_insert AFTER INSERT ON vc_member_capabilities BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=NEW.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_capability_delete AFTER DELETE ON vc_member_capabilities BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=OLD.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_capability_update AFTER UPDATE ON vc_member_capabilities BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id IN(SELECT organization_id FROM vc_sites WHERE id IN(NEW.site_id,OLD.site_id)); END`,
  `CREATE TABLE IF NOT EXISTS vc_cms_delete_proofs (
    collection TEXT NOT NULL, record_id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    actor_id INTEGER NOT NULL REFERENCES users(id), authority_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(collection,record_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_cms_delete_proofs_date_idx ON vc_cms_delete_proofs(created_at)`,
  `CREATE TRIGGER IF NOT EXISTS vc_user_authority_update AFTER UPDATE OF role ON users WHEN OLD.role IS NOT NEW.role BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id IN(
      SELECT s.organization_id FROM vc_sites s JOIN vc_site_memberships m ON m.site_id=s.id WHERE m.user_id=NEW.id); END`,
] as const

/** Compatibility applies once to pre-existing accounts, not to arbitrary new tenant accounts. */
export const legacyContentCapabilities = [
  `INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation)
    SELECT 'default',u.id,'content',o.operation FROM users u JOIN vc_site_memberships m ON m.user_id=u.id AND m.site_id='default' AND m.active=1
    CROSS JOIN (SELECT 'read' AS operation UNION ALL SELECT 'edit' UNION ALL SELECT 'publish' UNION ALL SELECT 'export') o`,
  `INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation)
    SELECT 'default',u.id,'content','configure' FROM users u JOIN vc_site_memberships m ON m.user_id=u.id AND m.site_id='default' AND m.active=1 WHERE u.role IN('administrator','designer')`,
  `INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation)
    SELECT 'default',u.id,'workspace','edit' FROM users u JOIN vc_site_memberships m ON m.user_id=u.id AND m.site_id='default' AND m.active=1`,
  `INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation)
    SELECT 'default',u.id,'forms','publish' FROM users u JOIN vc_site_memberships m ON m.user_id=u.id AND m.site_id='default' AND m.active=1 WHERE u.role='designer'`,
  `INSERT OR IGNORE INTO vc_member_restrictions(site_id,user_id,category,operation)
    SELECT 'default',u.id,'form-submissions','read' FROM users u JOIN vc_site_memberships m ON m.user_id=u.id AND m.site_id='default' AND m.active=1 WHERE u.role='designer'`,
] as const
