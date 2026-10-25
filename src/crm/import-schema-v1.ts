import { importedRecordExistsV1 } from './import-records-v1'
const domains =
  "'contacts','households','household-members','relationships','gifts','memberships','volunteer-profiles','volunteer-activities','volunteer-participation','volunteer-hours'"
const sourceContext = `EXISTS(SELECT 1 FROM vc_crm_import_runs r JOIN vc_sites s ON s.id=r.site_id
  JOIN vc_organizations o ON o.id=s.organization_id WHERE r.id=NEW.last_run_id AND r.site_id=NEW.site_id
  AND r.domain=NEW.domain AND r.source_system=NEW.platform AND s.organization_id=NEW.organization_id
  AND r.status='approved' AND r.approved_authority_revision=o.authority_revision)`
const rowContext = `EXISTS(SELECT 1 FROM vc_crm_import_runs r JOIN vc_sites s ON s.id=r.site_id
  JOIN vc_organizations o ON o.id=s.organization_id JOIN vc_crm_jobs j ON j.id=r.job_id
  WHERE r.id=NEW.run_id AND r.status='approved' AND r.approved_authority_revision=o.authority_revision
  AND r.config_revision=NEW.review_config_revision AND r.revision=NEW.validated_revision
  AND j.actor_id=r.actor_id AND j.site_id=r.site_id AND j.kind='import-apply')`
/** Additive reviewed-import persistence. Register its migration only with the
 * connected staff workflow and handlers; this schema alone is not a delivered phase.
 */
export const importSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_import_mappings (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),domain TEXT NOT NULL CHECK(domain IN(${domains})),
    name TEXT NOT NULL,mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)),revision INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_mappings_site_idx ON vc_crm_import_mappings(site_id,domain,archived,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_runs (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),actor_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,domain TEXT NOT NULL CHECK(domain IN(${domains})),source_system TEXT NOT NULL CHECK(length(source_system) BETWEEN 1 AND 120),
    file_name TEXT NOT NULL,file_kind TEXT NOT NULL CHECK(file_kind IN('csv','xlsx')),file_size INTEGER NOT NULL CHECK(file_size>0),
    file_sha256 TEXT NOT NULL CHECK(length(file_sha256)=64),file_key TEXT NOT NULL UNIQUE,file_uploaded_at TEXT,
    header_row INTEGER NOT NULL DEFAULT 1 CHECK(header_row>=1),sheet_name TEXT NOT NULL DEFAULT '',delimiter TEXT NOT NULL DEFAULT ',' CHECK(delimiter IN(',', ';',char(9))),
    headers_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(headers_json)),mapping_json TEXT CHECK(mapping_json IS NULL OR json_valid(mapping_json)),
    config_revision INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,
    stage_state TEXT NOT NULL DEFAULT 'uploading' CHECK(stage_state IN('uploading','ready','staging','review','failed')),stage_cursor TEXT NOT NULL DEFAULT '',stage_error TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved')),financial INTEGER NOT NULL DEFAULT 0 CHECK(financial IN(0,1)),
    allow_new_unidentified INTEGER NOT NULL DEFAULT 0 CHECK(allow_new_unidentified IN(0,1)),job_id TEXT REFERENCES vc_crm_jobs(id),
    approved_authority_revision INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_runs_site_idx ON vc_crm_import_runs(site_id,domain,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_runs_actor_idx ON vc_crm_import_runs(actor_id,site_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_import_rows (
    run_id TEXT NOT NULL REFERENCES vc_crm_import_runs(id),number INTEGER NOT NULL CHECK(number>0),
    data_json TEXT NOT NULL CHECK(json_valid(data_json) AND length(data_json)<=1048576),parse_issues TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(parse_issues)),
    revision INTEGER NOT NULL DEFAULT 1,decision TEXT CHECK(decision IN('create','update','keep','skip')),target_id TEXT,source_id TEXT,
    review_json TEXT CHECK(review_json IS NULL OR (json_valid(review_json) AND length(review_json)<=1048576)),review_hash TEXT CHECK(review_hash IS NULL OR length(review_hash)=64),
    review_config_revision INTEGER,review_authority_revision INTEGER,validated_revision INTEGER,
    applied_id TEXT,applied_action TEXT CHECK(applied_action IN('created','updated','kept','skipped')),applied_at TEXT,
    PRIMARY KEY(run_id,number),CHECK((applied_at IS NULL AND applied_action IS NULL AND applied_id IS NULL) OR (applied_at IS NOT NULL AND applied_action IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_rows_pending_idx ON vc_crm_import_rows(run_id,applied_at,number)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_import_rows_source_idx ON vc_crm_import_rows(run_id,source_id,number)`,
  // Retain the contact foundation's compound key and original record pointers.
  // Nullable provenance permits existing identifiers to remain unchanged until a
  // reviewed import explicitly adopts them; no historical pointer is rewritten.
  `ALTER TABLE vc_crm_source_identifiers ADD COLUMN fingerprint TEXT CHECK(fingerprint IS NULL OR length(fingerprint)=64)`,
  `ALTER TABLE vc_crm_source_identifiers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE vc_crm_source_identifiers ADD COLUMN created_run_id TEXT REFERENCES vc_crm_import_runs(id)`,
  `ALTER TABLE vc_crm_source_identifiers ADD COLUMN last_run_id TEXT REFERENCES vc_crm_import_runs(id)`,
  `ALTER TABLE vc_crm_source_identifiers ADD COLUMN updated_at TEXT`,
  `CREATE INDEX IF NOT EXISTS vc_crm_source_identifiers_record_idx ON vc_crm_source_identifiers(organization_id,domain,record_id,site_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_mapping_context BEFORE UPDATE ON vc_crm_import_mappings WHEN NEW.site_id<>OLD.site_id OR NEW.domain<>OLD.domain OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'Import mapping context is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_mapping_no_delete BEFORE DELETE ON vc_crm_import_mappings BEGIN SELECT RAISE(ABORT,'Archive import mappings instead'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_run_context BEFORE UPDATE ON vc_crm_import_runs WHEN NEW.id<>OLD.id OR NEW.site_id<>OLD.site_id OR NEW.actor_id<>OLD.actor_id
    OR NEW.domain<>OLD.domain OR NEW.source_system<>OLD.source_system OR NEW.file_name<>OLD.file_name OR NEW.file_kind<>OLD.file_kind OR NEW.file_size<>OLD.file_size
    OR NEW.file_sha256<>OLD.file_sha256 OR NEW.file_key<>OLD.file_key OR NEW.created_at<>OLD.created_at OR (OLD.file_uploaded_at IS NOT NULL AND NEW.file_uploaded_at IS NOT OLD.file_uploaded_at)
    OR (OLD.stage_state NOT IN('uploading','ready') AND (NEW.header_row<>OLD.header_row OR NEW.sheet_name<>OLD.sheet_name OR NEW.delimiter<>OLD.delimiter OR NEW.headers_json<>OLD.headers_json))
    OR NEW.financial<OLD.financial BEGIN SELECT RAISE(ABORT,'Import source context and classifications are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_run_frozen BEFORE UPDATE ON vc_crm_import_runs WHEN OLD.status='approved' AND NEW.status='approved'
    AND (NEW.name<>OLD.name OR NEW.mapping_json IS NOT OLD.mapping_json OR NEW.config_revision<>OLD.config_revision OR NEW.allow_new_unidentified<>OLD.allow_new_unidentified
      OR NEW.revision<>OLD.revision OR NEW.job_id IS NOT OLD.job_id OR NEW.approved_authority_revision IS NOT OLD.approved_authority_revision)
    BEGIN SELECT RAISE(ABORT,'Reopen an import before changing its approval'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_approval BEFORE UPDATE ON vc_crm_import_runs WHEN OLD.status='draft' AND NEW.status='approved' AND (
    NEW.stage_state<>'review' OR NEW.mapping_json IS NULL OR NEW.job_id IS NULL OR NEW.approved_authority_revision IS NOT (SELECT o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=NEW.site_id)
    OR NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=NEW.job_id AND j.site_id=NEW.site_id AND j.actor_id=NEW.actor_id AND j.kind='import-apply')
    OR NOT EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=NEW.id AND applied_at IS NULL)
    OR (NEW.allow_new_unidentified=0 AND EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=NEW.id AND applied_at IS NULL AND decision='create' AND source_id IS NULL))
    OR EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=NEW.id AND applied_at IS NULL AND (decision IS NULL OR review_hash IS NULL OR review_config_revision IS NOT NEW.config_revision OR review_authority_revision IS NOT NEW.approved_authority_revision OR json_type(review_json,'$.issues') IS NOT 'array' OR (decision<>'skip' AND json_array_length(json_extract(review_json,'$.issues'))<>0)))
    OR EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=NEW.id AND decision<>'skip' AND source_id IS NOT NULL GROUP BY source_id HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=NEW.id AND decision<>'skip' AND target_id IS NOT NULL GROUP BY target_id HAVING count(*)>1))
    BEGIN SELECT RAISE(ABORT,'Import review is incomplete, duplicated or stale'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_run_no_delete BEFORE DELETE ON vc_crm_import_runs BEGIN SELECT RAISE(ABORT,'Import history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_row_insert BEFORE INSERT ON vc_crm_import_rows WHEN NOT EXISTS(SELECT 1 FROM vc_crm_import_runs WHERE id=NEW.run_id AND status='draft' AND stage_state='staging') OR NEW.applied_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'Rows require a draft staging import'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_row_context BEFORE UPDATE ON vc_crm_import_rows WHEN NEW.run_id<>OLD.run_id OR NEW.number<>OLD.number OR NEW.data_json<>OLD.data_json OR NEW.parse_issues<>OLD.parse_issues OR OLD.applied_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'Import source and applied rows are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_row_review BEFORE UPDATE ON vc_crm_import_rows WHEN (NEW.revision<>OLD.revision OR NEW.decision IS NOT OLD.decision OR NEW.target_id IS NOT OLD.target_id OR NEW.source_id IS NOT OLD.source_id OR NEW.review_json IS NOT OLD.review_json OR NEW.review_hash IS NOT OLD.review_hash OR NEW.review_config_revision IS NOT OLD.review_config_revision OR NEW.review_authority_revision IS NOT OLD.review_authority_revision)
    AND NOT EXISTS(SELECT 1 FROM vc_crm_import_runs WHERE id=NEW.run_id AND status='draft' AND stage_state='review') BEGIN SELECT RAISE(ABORT,'Reopen an import before reviewing rows'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_row_apply BEFORE UPDATE OF applied_at,applied_id,applied_action ON vc_crm_import_rows WHEN NEW.applied_at IS NOT NULL AND (NOT (${rowContext})
    OR NEW.applied_action IS NOT CASE NEW.decision WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'keep' THEN 'kept' WHEN 'skip' THEN 'skipped' END
    OR (NEW.decision='skip' AND NEW.applied_id IS NOT NULL) OR (NEW.decision<>'skip' AND (NEW.applied_id IS NULL OR NOT (${importedRecordExistsV1('(SELECT domain FROM vc_crm_import_runs WHERE id=NEW.run_id)', '(SELECT site_id FROM vc_crm_import_runs WHERE id=NEW.run_id)', 'NEW.applied_id')}))))
    BEGIN SELECT RAISE(ABORT,'Applying an import requires current reviewed context'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_import_row_no_delete BEFORE DELETE ON vc_crm_import_rows BEGIN SELECT RAISE(ABORT,'Import rows are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_source_identifier_insert BEFORE INSERT ON vc_crm_source_identifiers WHEN NEW.fingerprint IS NULL OR NEW.created_run_id IS NULL OR NEW.last_run_id IS NULL OR NEW.created_run_id<>NEW.last_run_id
    OR length(NEW.platform) NOT BETWEEN 1 AND 120 OR length(NEW.external_id) NOT BETWEEN 1 AND 256 OR NEW.external_id<>trim(NEW.external_id)
    OR NOT (${sourceContext}) OR NOT (${importedRecordExistsV1('NEW.domain', 'NEW.site_id', 'NEW.record_id')}) BEGIN SELECT RAISE(ABORT,'Source identifiers require an approved scoped record'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_source_identifier_update BEFORE UPDATE ON vc_crm_source_identifiers WHEN NEW.organization_id<>OLD.organization_id OR NEW.site_id<>OLD.site_id OR NEW.domain<>OLD.domain OR NEW.platform<>OLD.platform OR NEW.external_id<>OLD.external_id OR NEW.record_id<>OLD.record_id OR (OLD.created_run_id IS NOT NULL AND NEW.created_run_id IS NOT OLD.created_run_id) OR NEW.created_at<>OLD.created_at
    OR NEW.created_run_id IS NULL OR NEW.last_run_id IS NULL OR NEW.fingerprint IS NULL OR (OLD.created_run_id IS NULL AND NEW.created_run_id<>NEW.last_run_id) OR NOT (${sourceContext}) BEGIN SELECT RAISE(ABORT,'Source identifier lineage is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_source_identifier_no_delete BEFORE DELETE ON vc_crm_source_identifiers BEGIN SELECT RAISE(ABORT,'Source identifiers are retained'); END`,
] as const

/** Repeated additive upgrades preserve the original source-identifier columns. */
export async function applyImportSchemaV1(
  execute: (statement: string) => Promise<unknown>,
  sourceColumns: () => Promise<Array<{ name: string }>>,
) {
  const columns = await sourceColumns()
  for (const statement of importSchemaV1) {
    const column = /^ALTER TABLE vc_crm_source_identifiers ADD COLUMN (\w+)/.exec(statement)?.[1]
    if (column && columns.some((existing) => existing.name === column)) continue
    await execute(statement)
  }
}
