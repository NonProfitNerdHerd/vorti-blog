export const knowledgeSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_knowledge_pages(
    id TEXT PRIMARY KEY NOT NULL,tenant_id TEXT NOT NULL REFERENCES vc_organizations(id),site_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('wiki','intranet')),parent_id TEXT REFERENCES vc_knowledge_pages(id),
    title TEXT NOT NULL,slug TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),
    visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN('public','private')),
    published_title TEXT,published_body TEXT CHECK(published_body IS NULL OR json_valid(published_body)),
    revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),
    creator_id INTEGER NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,
    FOREIGN KEY(site_id,tenant_id) REFERENCES vc_sites(id,organization_id),UNIQUE(site_id,kind,slug),
    CHECK(kind='wiki' OR visibility='private')
  )`,
  `CREATE INDEX IF NOT EXISTS vc_knowledge_scope ON vc_knowledge_pages(site_id,kind,deleted,id)`,
  `CREATE INDEX IF NOT EXISTS vc_knowledge_parent ON vc_knowledge_pages(parent_id)`,
  `CREATE TABLE IF NOT EXISTS vc_knowledge_versions(
    id TEXT PRIMARY KEY NOT NULL,page_id TEXT NOT NULL REFERENCES vc_knowledge_pages(id),revision INTEGER NOT NULL,
    title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(page_id,revision)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_knowledge_attachments(
    id TEXT PRIMARY KEY NOT NULL,page_id TEXT NOT NULL REFERENCES vc_knowledge_pages(id),
    object_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,
    created_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))
  )`,
  `CREATE VIEW IF NOT EXISTS vc_knowledge_ancestry AS WITH RECURSIVE lineage(descendant_id,ancestor_id,distance) AS (
    SELECT id,id,0 FROM vc_knowledge_pages UNION ALL
    SELECT l.descendant_id,p.parent_id,l.distance+1 FROM lineage l JOIN vc_knowledge_pages p ON p.id=l.ancestor_id WHERE p.parent_id IS NOT NULL
  ) SELECT * FROM lineage`,
  `CREATE TRIGGER IF NOT EXISTS vc_knowledge_ownership BEFORE UPDATE OF tenant_id,site_id,kind ON vc_knowledge_pages
    WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.site_id IS NOT NEW.site_id OR OLD.kind IS NOT NEW.kind
    BEGIN SELECT RAISE(ABORT,'Knowledge ownership is immutable'); END`,
  ...['INSERT', 'UPDATE'].map(
    (
      operation,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_knowledge_parent_${operation.toLowerCase()} BEFORE ${operation} ON vc_knowledge_pages
    WHEN NEW.parent_id IS NOT NULL AND (NEW.parent_id=NEW.id OR NOT EXISTS(SELECT 1 FROM vc_knowledge_pages p WHERE p.id=NEW.parent_id AND p.tenant_id=NEW.tenant_id AND p.site_id=NEW.site_id AND p.kind=NEW.kind AND p.deleted=0)
    OR EXISTS(SELECT 1 FROM vc_knowledge_ancestry WHERE descendant_id=NEW.parent_id AND ancestor_id=NEW.id)
    OR EXISTS(SELECT 1 FROM vc_knowledge_ancestry WHERE descendant_id=NEW.parent_id AND distance>=63))
    BEGIN SELECT RAISE(ABORT,'Invalid knowledge hierarchy'); END`,
  ),
  ...['UPDATE', 'DELETE'].map(
    (operation) =>
      `CREATE TRIGGER IF NOT EXISTS vc_knowledge_versions_${operation.toLowerCase()} BEFORE ${operation} ON vc_knowledge_versions BEGIN SELECT RAISE(ABORT,'Knowledge history is immutable'); END`,
  ),
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (operation) =>
      `CREATE TRIGGER IF NOT EXISTS vc_knowledge_epoch_${operation.toLowerCase()} AFTER ${operation} ON vc_knowledge_pages BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=${operation === 'DELETE' ? 'OLD' : 'NEW'}.tenant_id; END`,
  ),
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (operation) =>
      `CREATE TRIGGER IF NOT EXISTS vc_knowledge_file_epoch_${operation.toLowerCase()} AFTER ${operation} ON vc_knowledge_attachments BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=(SELECT tenant_id FROM vc_knowledge_pages WHERE id=${operation === 'DELETE' ? 'OLD' : 'NEW'}.page_id); END`,
  ),
]
