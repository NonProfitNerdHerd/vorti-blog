import { crmRecordRulesV1, type CRMRecordTypeV1 } from './record-context-v1'

/** Draft additive schema: private immutable content, recoverable publication/archive state. */
export const attachmentSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_attachments (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),
    record_type TEXT NOT NULL CHECK(record_type IN('contact','household','gift','pledge','recurring','membership','opportunity','volunteer-activity')),record_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN('communications','finances','memberships','volunteer-experience','volunteer-hours','restricted-activity')),
    filename TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 26214400),
    sha256 TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,created_by INTEGER NOT NULL REFERENCES users(id),
    state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN('staged','ready','archived','cancelled','expired')),
    ready_at TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    CHECK((state IN('ready','archived') AND ready_at IS NOT NULL) OR (state IN('staged','cancelled','expired') AND ready_at IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_attachment_record_idx ON vc_crm_attachments(site_id,record_type,record_id,category,state,created_at,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_attachment_expiry_idx ON vc_crm_attachments(state,created_at,id) WHERE ready_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS vc_crm_attachment_events (
    id TEXT PRIMARY KEY NOT NULL,attachment_id TEXT NOT NULL REFERENCES vc_crm_attachments(id),
    action TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),operation_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_attachment_events_idx ON vc_crm_attachment_events(attachment_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_identity BEFORE UPDATE OF site_id,record_type,record_id,category,filename,mime,bytes,sha256,object_key,created_by,created_at ON vc_crm_attachments
    BEGIN SELECT RAISE(ABORT,'Attachment context and content are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_publication BEFORE UPDATE OF ready_at ON vc_crm_attachments
    WHEN OLD.ready_at IS NOT NULL AND NEW.ready_at IS NOT OLD.ready_at BEGIN SELECT RAISE(ABORT,'Attachment publication history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_no_delete BEFORE DELETE ON vc_crm_attachments BEGIN SELECT RAISE(ABORT,'Attachment history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_state BEFORE UPDATE OF state ON vc_crm_attachments
    WHEN NEW.state<>OLD.state AND NOT ((OLD.state='staged' AND NEW.state IN('ready','cancelled','expired')) OR (OLD.state='ready' AND NEW.state='archived') OR (OLD.state='archived' AND NEW.state='ready'))
    BEGIN SELECT RAISE(ABORT,'Attachment state transition is invalid'); END`,
  ...(Object.keys(crmRecordRulesV1) as CRMRecordTypeV1[]).map((type) => {
    let position = 0
    const context = crmRecordRulesV1[type].sql.replace(/\?/g, () =>
      ++position === 1 ? 'NEW.site_id' : 'NEW.record_id',
    )
    return `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_${type.replaceAll('-', '_')}_scope BEFORE INSERT ON vc_crm_attachments
      WHEN NEW.record_type='${type}' AND NOT EXISTS(${context}) BEGIN SELECT RAISE(ABORT,'Attachment requires an authorized chapter record'); END`
  }),
  ...['UPDATE', 'DELETE'].map(
    (event) =>
      `CREATE TRIGGER IF NOT EXISTS vc_crm_attachment_event_${event.toLowerCase()} BEFORE ${event} ON vc_crm_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment events are retained'); END`,
  ),
] as const
