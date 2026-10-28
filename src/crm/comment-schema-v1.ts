export const commentSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_comments (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id), author_label TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_comments_contact_idx ON vc_crm_comments(site_id,constituent_id,created_at DESC,id DESC)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_comments_scope BEFORE INSERT ON vc_crm_comments
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Comment requires an active chapter contact'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_comments_owner BEFORE UPDATE OF site_id,constituent_id,created_by,author_label,created_at ON vc_crm_comments
    BEGIN SELECT RAISE(ABORT,'Comment ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_comments_no_delete BEFORE DELETE ON vc_crm_comments
    BEGIN SELECT RAISE(ABORT,'Comment history is retained'); END`,
] as const
