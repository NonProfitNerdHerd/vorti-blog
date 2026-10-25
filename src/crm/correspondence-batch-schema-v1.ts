/** Draft reviews can change; issued document links and batch/recipient ownership remain permanent. */
export const correspondenceBatchSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_correspondence_batches (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),actor_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,config TEXT NOT NULL CHECK(json_valid(config)),config_revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved')),revision INTEGER NOT NULL DEFAULT 1,
    financial INTEGER NOT NULL DEFAULT 0 CHECK(financial IN(0,1)),membership INTEGER NOT NULL DEFAULT 0 CHECK(membership IN(0,1)),
    job_id TEXT REFERENCES vc_crm_jobs(id),approved_authority_revision INTEGER,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_correspondence_batches_actor_idx ON vc_crm_correspondence_batches(site_id,actor_id,updated_at,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_correspondence_batches_site_idx ON vc_crm_correspondence_batches(site_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_correspondence_recipients (
    id TEXT PRIMARY KEY NOT NULL,batch_id TEXT NOT NULL REFERENCES vc_crm_correspondence_batches(id),
    site_id TEXT NOT NULL REFERENCES vc_sites(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    source_key TEXT NOT NULL,recipient TEXT NOT NULL CHECK(json_valid(recipient)),
    request TEXT NOT NULL CHECK(json_valid(request)),preview TEXT NOT NULL CHECK(json_valid(preview)),approval TEXT NOT NULL CHECK(length(approval)=64),
    config_revision INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,validated_revision INTEGER,
    removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)),document_id TEXT UNIQUE REFERENCES vc_crm_documents(id),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(batch_id,source_key)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_correspondence_recipients_page_idx ON vc_crm_correspondence_recipients(batch_id,removed,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_batch_context BEFORE UPDATE OF site_id,actor_id ON vc_crm_correspondence_batches
    BEGIN SELECT RAISE(ABORT,'Correspondence batch context is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_batch_delete BEFORE DELETE ON vc_crm_correspondence_batches
    BEGIN SELECT RAISE(ABORT,'Correspondence batches are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_batch_review BEFORE UPDATE OF name,config,config_revision ON vc_crm_correspondence_batches
    WHEN OLD.status<>'draft' OR NEW.status<>'draft' BEGIN SELECT RAISE(ABORT,'Reopen correspondence before editing its configuration'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_batch_classification BEFORE UPDATE OF financial,membership ON vc_crm_correspondence_batches
    WHEN NEW.financial<OLD.financial OR NEW.membership<OLD.membership BEGIN SELECT RAISE(ABORT,'Retain correspondence access classifications'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_recipient_insert BEFORE INSERT ON vc_crm_correspondence_recipients WHEN
    NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_batches b JOIN vc_crm_affiliations a ON a.site_id=b.site_id
      AND a.constituent_id=NEW.constituent_id AND a.archived=0 JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0
      WHERE b.id=NEW.batch_id AND b.site_id=NEW.site_id AND b.status='draft' AND b.config_revision=NEW.config_revision
      AND json_extract(NEW.request,'$.site')=b.site_id AND json_extract(NEW.request,'$.contact')=NEW.constituent_id
      AND json_extract(NEW.preview,'$.constituent')=NEW.constituent_id
      AND json_extract(NEW.preview,'$.template.id')=json_extract(b.config,'$.template')
      AND b.financial>=json_extract(NEW.preview,'$.financial')
      AND b.membership>=CASE WHEN json_type(NEW.preview,'$.membership')='object' THEN 1 ELSE 0 END)
    BEGIN SELECT RAISE(ABORT,'Correspondence recipient context is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_recipient_context BEFORE UPDATE OF batch_id,site_id,constituent_id,source_key ON vc_crm_correspondence_recipients
    BEGIN SELECT RAISE(ABORT,'Correspondence recipient context is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_recipient_review BEFORE UPDATE OF recipient,request,preview,approval,config_revision,removed ON vc_crm_correspondence_recipients WHEN
    OLD.document_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM vc_crm_correspondence_batches b WHERE b.id=OLD.batch_id AND b.status='draft')
    BEGIN SELECT RAISE(ABORT,'Approve new reviews before issuing correspondence'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_recipient_document BEFORE UPDATE OF document_id ON vc_crm_correspondence_recipients WHEN
    OLD.document_id IS NOT NULL OR NEW.document_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM vc_crm_correspondence_batches b JOIN vc_crm_documents d ON d.id=NEW.document_id
      WHERE b.id=OLD.batch_id AND b.status='approved' AND d.site_id=OLD.site_id AND d.constituent_id=OLD.constituent_id AND d.actor_id=b.actor_id
      AND d.template_version_id=json_extract(OLD.preview,'$.template.version') AND d.kind=json_extract(OLD.preview,'$.template.kind')
      AND d.issued_on=json_extract(OLD.preview,'$.issuedOn'))
    BEGIN SELECT RAISE(ABORT,'Issued correspondence links are permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_correspondence_recipient_delete BEFORE DELETE ON vc_crm_correspondence_recipients
    BEGIN SELECT RAISE(ABORT,'Correspondence recipient history is retained'); END`,
] as const
