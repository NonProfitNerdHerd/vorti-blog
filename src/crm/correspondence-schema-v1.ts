/** Issued snapshots and template versions are append-only; delivery state lives separately. */
export const correspondenceSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_maintenance (name TEXT PRIMARY KEY NOT NULL,cursor TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_job_document_idx ON vc_crm_jobs(site_id,json_extract(payload,'$.document'),created_at,id) WHERE kind='correspondence'`,
  `CREATE TABLE IF NOT EXISTS vc_crm_templates (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('gift-receipt','thank-you','annual-statement','membership-renewal','general')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_templates_site_idx ON vc_crm_templates(site_id,archived,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_template_versions (
    id TEXT PRIMARY KEY NOT NULL, template_id TEXT NOT NULL REFERENCES vc_crm_templates(id),
    revision INTEGER NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
    UNIQUE(template_id,revision)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_documents (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id),
    constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    template_version_id TEXT NOT NULL REFERENCES vc_crm_template_versions(id),
    actor_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
    financial INTEGER NOT NULL CHECK(financial IN(0,1)), membership INTEGER NOT NULL CHECK(membership IN(0,1)),
    subject TEXT NOT NULL, body TEXT NOT NULL, snapshot TEXT NOT NULL,
    issued_on TEXT NOT NULL, created_at TEXT NOT NULL,
    supersedes_id TEXT REFERENCES vc_crm_documents(id),
    UNIQUE(supersedes_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_documents_contact_idx ON vc_crm_documents(site_id,constituent_id,created_at,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_document_files (
    document_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_documents(id),
    object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0),
    created_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_template_ownership BEFORE UPDATE OF site_id,kind ON vc_crm_templates
    BEGIN SELECT RAISE(ABORT,'Template context is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_template_version_update BEFORE UPDATE ON vc_crm_template_versions
    BEGIN SELECT RAISE(ABORT,'Template versions are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_template_version_delete BEFORE DELETE ON vc_crm_template_versions
    BEGIN SELECT RAISE(ABORT,'Template versions are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_document_update BEFORE UPDATE ON vc_crm_documents
    BEGIN SELECT RAISE(ABORT,'Issued documents are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_document_delete BEFORE DELETE ON vc_crm_documents
    BEGIN SELECT RAISE(ABORT,'Issued documents are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_document_file_update BEFORE UPDATE ON vc_crm_document_files
    BEGIN SELECT RAISE(ABORT,'Issued document files are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_document_context BEFORE INSERT ON vc_crm_documents
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_template_versions v JOIN vc_crm_templates t ON t.id=v.template_id
      WHERE v.id=NEW.template_version_id AND t.site_id=NEW.site_id AND t.kind=NEW.kind)
    OR NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id
      WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0 AND c.archived=0)
    OR (NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_documents d
      WHERE d.id=NEW.supersedes_id AND d.site_id=NEW.site_id AND d.constituent_id=NEW.constituent_id AND d.kind=NEW.kind))
    BEGIN SELECT RAISE(ABORT,'Document context is invalid'); END`,
] as const
