/** Additive authority restrictions. Never modify schema-v1 after release. */
export const organizationSchemaV2 = [
  `CREATE TABLE IF NOT EXISTS vc_member_restrictions (
    site_id TEXT NOT NULL, user_id INTEGER NOT NULL, category TEXT NOT NULL, operation TEXT NOT NULL,
    PRIMARY KEY(site_id,user_id,category,operation),
    FOREIGN KEY(site_id,user_id) REFERENCES vc_site_memberships(site_id,user_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_restriction_insert AFTER INSERT ON vc_member_restrictions BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=NEW.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_restriction_delete AFTER DELETE ON vc_member_restrictions BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT organization_id FROM vc_sites WHERE id=OLD.site_id); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_restriction_update AFTER UPDATE ON vc_member_restrictions BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id IN(SELECT organization_id FROM vc_sites WHERE id IN(NEW.site_id,OLD.site_id)); END`,
  `CREATE TABLE IF NOT EXISTS vc_account_status (
    user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id), disabled INTEGER NOT NULL CHECK(disabled IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_account_status_insert AFTER INSERT ON vc_account_status BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_account_status_update AFTER UPDATE ON vc_account_status BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
  `CREATE TRIGGER IF NOT EXISTS vc_account_status_delete AFTER DELETE ON vc_account_status BEGIN
    UPDATE vc_organizations SET authority_revision=authority_revision+1; END`,
] as const
