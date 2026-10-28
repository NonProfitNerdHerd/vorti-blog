/** Additive sharing structures. Legacy knowledge tables and immutable versions remain intact. */
export const publishingSharingSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_publishing_export_manifests(
    export_id INTEGER PRIMARY KEY REFERENCES exports(id) ON DELETE CASCADE,site_id TEXT NOT NULL REFERENCES vc_sites(id),
    owner_id INTEGER NOT NULL REFERENCES users(id),source_count INTEGER NOT NULL,ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN(0,1)))`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_export_records(
    export_id INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,collection TEXT NOT NULL,record_id INTEGER NOT NULL,
    audience TEXT NOT NULL CHECK(audience IN('public','intranet')),identity TEXT NOT NULL,PRIMARY KEY(export_id,collection,record_id))`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_private_history(
    collection TEXT NOT NULL CHECK(collection IN('posts','pages')),document_id INTEGER NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES vc_organizations(id),site_id TEXT NOT NULL REFERENCES vc_sites(id),
    readership TEXT NOT NULL CHECK(readership IN('site','restricted')),owner_id INTEGER REFERENCES users(id),
    people TEXT NOT NULL CHECK(json_valid(people) AND json_type(people)='array'),groups TEXT NOT NULL CHECK(json_valid(groups) AND json_type(groups)='array'),
    parent_id INTEGER,parent_created_at TEXT,parent_identity TEXT,document_created_at TEXT NOT NULL,document_identity TEXT NOT NULL,published INTEGER NOT NULL CHECK(published IN(0,1)),published_at TEXT,
    operation_key TEXT NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(collection,document_id))`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_portal_seeds(
    site_id TEXT PRIMARY KEY REFERENCES vc_sites(id),version INTEGER NOT NULL CHECK(version=1),created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_groups(
    id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES vc_organizations(id),
    site_id TEXT NOT NULL REFERENCES vc_sites(id),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(site_id,name))`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_group_members(
    group_id TEXT NOT NULL REFERENCES vc_publishing_groups(id),user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY(group_id,user_id))`,
  `CREATE INDEX IF NOT EXISTS vc_publishing_group_member_user ON vc_publishing_group_members(user_id,group_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_group_scope_insert BEFORE INSERT ON vc_publishing_groups
    WHEN NOT EXISTS(SELECT 1 FROM vc_sites WHERE id=NEW.site_id AND organization_id=NEW.tenant_id)
    BEGIN SELECT RAISE(ABORT,'Invalid sharing group scope'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_group_scope_update BEFORE UPDATE ON vc_publishing_groups
    WHEN NEW.site_id IS NOT OLD.site_id OR NEW.tenant_id IS NOT OLD.tenant_id
    BEGIN SELECT RAISE(ABORT,'Sharing group scope is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_group_member_insert BEFORE INSERT ON vc_publishing_group_members
    WHEN NOT EXISTS(SELECT 1 FROM vc_publishing_groups g JOIN vc_tenant_memberships m ON m.tenant_id=g.tenant_id
      WHERE g.id=NEW.group_id AND g.retired=0 AND m.user_id=NEW.user_id AND m.active=1
      AND EXISTS(SELECT 1 FROM vc_tenant_user_sites permitted WHERE permitted.user_id=m.user_id AND permitted.site=g.site_id)
      AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1))
    BEGIN SELECT RAISE(ABORT,'Sharing recipient unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_group_member_update BEFORE UPDATE ON vc_publishing_group_members
    BEGIN SELECT RAISE(ABORT,'Replace sharing memberships through the audited group operation'); END`,
  ...['INSERT', 'UPDATE', 'DELETE'].map(operation => `CREATE TRIGGER IF NOT EXISTS vc_publishing_group_epoch_${operation.toLowerCase()}
    AFTER ${operation} ON vc_publishing_groups BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1
    WHERE id=${operation === 'DELETE' ? 'OLD' : 'NEW'}.tenant_id; END`),
  ...['INSERT', 'DELETE'].map(operation => `CREATE TRIGGER IF NOT EXISTS vc_publishing_member_epoch_${operation.toLowerCase()}
    AFTER ${operation} ON vc_publishing_group_members BEGIN UPDATE vc_organizations SET authority_revision=authority_revision+1
    WHERE id=(SELECT tenant_id FROM vc_publishing_groups WHERE id=${operation === 'DELETE' ? 'OLD' : 'NEW'}.group_id); END`),
  `CREATE TABLE IF NOT EXISTS vc_publishing_legacy_map(
    legacy_id TEXT PRIMARY KEY REFERENCES vc_knowledge_pages(id),page_id INTEGER NOT NULL UNIQUE,
    legacy_revision INTEGER NOT NULL,content_hash TEXT NOT NULL,attachment_map TEXT NOT NULL DEFAULT '{}',
    converted_at TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_legacy_map_update BEFORE UPDATE ON vc_publishing_legacy_map
    BEGIN SELECT RAISE(ABORT,'Publishing migration lineage is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_publishing_legacy_map_delete BEFORE DELETE ON vc_publishing_legacy_map
    BEGIN SELECT RAISE(ABORT,'Publishing migration lineage is immutable'); END`,
  `CREATE TABLE IF NOT EXISTS vc_publishing_transfer_operations(
    operation_key TEXT PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),site_id TEXT NOT NULL REFERENCES vc_sites(id),
    source_collection TEXT NOT NULL CHECK(source_collection IN('posts','pages')),source_id INTEGER NOT NULL,
    destination_audience TEXT NOT NULL CHECK(destination_audience IN('public','intranet')),
    mode TEXT NOT NULL CHECK(mode IN('copy','move')),source_revision TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','completed','blocked')),
    destination_id INTEGER,created_at TEXT NOT NULL)`,
] as const
