/** Private, resumable import result files. Source rows and financial records stay unchanged. */
export const importExportSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_import_exports(
    id TEXT PRIMARY KEY NOT NULL,run_id TEXT NOT NULL REFERENCES vc_crm_import_runs(id),job_id TEXT UNIQUE NOT NULL REFERENCES vc_crm_jobs(id),
    run_revision INTEGER NOT NULL,run_updated_at TEXT NOT NULL,authority_revision INTEGER NOT NULL,
    errors_only INTEGER NOT NULL CHECK(errors_only IN(0,1)),expected_rows INTEGER NOT NULL CHECK(expected_rows>=0),
    columns INTEGER NOT NULL CHECK(columns>=0),created_at TEXT NOT NULL,expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_exports_run_idx ON vc_crm_import_exports(run_id,created_at,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_exports_expiry_idx ON vc_crm_import_exports(expires_at,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_export_chunks(
    export_id TEXT NOT NULL REFERENCES vc_crm_import_exports(id),ordinal INTEGER NOT NULL CHECK(ordinal>=0),
    object_key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL CHECK(length(sha256)=64),bytes INTEGER NOT NULL CHECK(bytes>0),
    rows INTEGER NOT NULL CHECK(rows>=0),snapshots TEXT NOT NULL CHECK(json_valid(snapshots)),deleted_at TEXT,
    PRIMARY KEY(export_id,ordinal))`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_context BEFORE INSERT ON vc_crm_import_exports WHEN NOT EXISTS(
    SELECT 1 FROM vc_crm_import_runs r JOIN vc_crm_jobs j ON j.id=NEW.job_id WHERE r.id=NEW.run_id AND r.actor_id=j.actor_id AND r.site_id=j.site_id AND j.kind='import-apply')
    BEGIN SELECT RAISE(ABORT,'Import export requires its owned job'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_retained BEFORE UPDATE ON vc_crm_import_exports BEGIN SELECT RAISE(ABORT,'Import export snapshots are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_no_delete BEFORE DELETE ON vc_crm_import_exports BEGIN SELECT RAISE(ABORT,'Import export history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_chunk_retained BEFORE UPDATE ON vc_crm_import_export_chunks WHEN NEW.export_id<>OLD.export_id OR NEW.ordinal<>OLD.ordinal OR NEW.object_key<>OLD.object_key OR NEW.sha256<>OLD.sha256 OR NEW.bytes<>OLD.bytes OR NEW.rows<>OLD.rows OR NEW.snapshots<>OLD.snapshots OR OLD.deleted_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Import export chunk context is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_chunk_no_delete BEFORE DELETE ON vc_crm_import_export_chunks BEGIN SELECT RAISE(ABORT,'Import export history is retained'); END`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_export_uploads(
    export_id TEXT PRIMARY KEY REFERENCES vc_crm_import_exports(id),object_key TEXT UNIQUE NOT NULL,upload_id TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes>0),chunks INTEGER NOT NULL CHECK(chunks>0))`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_export_steps(
    export_id TEXT NOT NULL REFERENCES vc_crm_import_exports(id),step INTEGER NOT NULL CHECK(step>=0),
    object_key TEXT UNIQUE,bytes INTEGER NOT NULL CHECK(bytes>0),sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    part_number INTEGER,etag TEXT,position TEXT NOT NULL CHECK(json_valid(position)),
    PRIMARY KEY(export_id,step),UNIQUE(export_id,part_number),CHECK((part_number IS NULL AND etag IS NULL AND object_key IS NOT NULL) OR(part_number>0 AND etag IS NOT NULL AND object_key IS NULL)))`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_export_files(
    export_id TEXT PRIMARY KEY REFERENCES vc_crm_import_exports(id),object_key TEXT UNIQUE NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes>0),etag TEXT NOT NULL,created_at TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_file_context BEFORE INSERT ON vc_crm_import_export_files WHEN NOT EXISTS(
    SELECT 1 FROM vc_crm_import_export_uploads u WHERE u.export_id=NEW.export_id AND u.object_key=NEW.object_key AND u.bytes=NEW.bytes)
    BEGIN SELECT RAISE(ABORT,'Published import result requires its retained upload'); END`,
  ...['uploads', 'steps', 'files'].flatMap((name) => [
    `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_${name}_retained BEFORE UPDATE ON vc_crm_import_export_${name} BEGIN SELECT RAISE(ABORT,'Import result assembly history is retained'); END`,
    `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_${name}_no_delete BEFORE DELETE ON vc_crm_import_export_${name} BEGIN SELECT RAISE(ABORT,'Import result assembly history is retained'); END`,
  ]),
  `CREATE TABLE IF NOT EXISTS vc_crm_import_export_cleanup(kind TEXT NOT NULL CHECK(kind IN('object','upload')),object_key TEXT NOT NULL,export_id TEXT REFERENCES vc_crm_import_exports(id),removed_at TEXT NOT NULL,PRIMARY KEY(kind,object_key))`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_cleanup_retained BEFORE UPDATE ON vc_crm_import_export_cleanup BEGIN SELECT RAISE(ABORT,'Result cleanup history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_export_cleanup_no_delete BEFORE DELETE ON vc_crm_import_export_cleanup BEGIN SELECT RAISE(ABORT,'Result cleanup history is retained'); END`,
] as const
