export const activitySchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_activities (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    kind TEXT NOT NULL CHECK(kind IN('note','phone','email','letter','meeting','other')), subject TEXT NOT NULL,
    body TEXT NOT NULL, occurred_on TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_activity_contact_idx ON vc_crm_activities(site_id,constituent_id,occurred_on,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_activity_scope BEFORE INSERT ON vc_crm_activities
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Activity requires an active chapter contact'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_activity_update_scope BEFORE UPDATE ON vc_crm_activities
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Activity requires an active chapter contact'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_activity_owner BEFORE UPDATE OF site_id,constituent_id,created_by,created_at ON vc_crm_activities
    BEGIN SELECT RAISE(ABORT,'Activity ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_activity_no_delete BEFORE DELETE ON vc_crm_activities
    BEGIN SELECT RAISE(ABORT,'Activity history is retained'); END`,
] as const
