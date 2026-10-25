export const emailSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_email_settings (
    site_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_sites(id),provider TEXT NOT NULL CHECK(provider IN('disabled','resend')),
    sender_email TEXT NOT NULL,sender_name TEXT NOT NULL,reply_to TEXT NOT NULL,domain_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,
    verified_at TEXT,credential_fingerprint TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_email_outbox (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),document_id TEXT NOT NULL UNIQUE REFERENCES vc_crm_documents(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    provider TEXT NOT NULL CHECK(provider='resend'),settings_revision INTEGER NOT NULL,contact_revision INTEGER NOT NULL,
    payload TEXT NOT NULL,payload_hash TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','accepted','delivered','bounced','complained','failed','uncertain','cancelled')),
    provider_id TEXT,first_attempt_at TEXT,uncertain_since TEXT,attempts INTEGER NOT NULL DEFAULT 0,fence INTEGER NOT NULL DEFAULT 0,
    lease_until TEXT,next_attempt_at TEXT NOT NULL,next_reconcile_at TEXT,last_provider_event TEXT,error TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN(0,1)),
    revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_email_pending_idx ON vc_crm_email_outbox(status,next_attempt_at,lease_until,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_email_site_idx ON vc_crm_email_outbox(site_id,created_at,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_email_reconcile_idx ON vc_crm_email_outbox(status,next_reconcile_at,id) WHERE provider_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS vc_crm_email_events (
    id TEXT PRIMARY KEY NOT NULL,outbox_id TEXT NOT NULL REFERENCES vc_crm_email_outbox(id),fence INTEGER NOT NULL,
    event TEXT NOT NULL,provider_id TEXT,actor_id INTEGER REFERENCES users(id),detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_email_events_idx ON vc_crm_email_events(outbox_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_payload_immutable BEFORE UPDATE OF site_id,document_id,actor_id,constituent_id,provider,settings_revision,contact_revision,payload,payload_hash,idempotency_key,created_at ON vc_crm_email_outbox
    BEGIN SELECT RAISE(ABORT,'Approved email payload is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_no_delete BEFORE DELETE ON vc_crm_email_outbox BEGIN SELECT RAISE(ABORT,'Email delivery history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_attempt_anchor BEFORE UPDATE OF first_attempt_at ON vc_crm_email_outbox WHEN OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS NOT OLD.first_attempt_at BEGIN SELECT RAISE(ABORT,'Original delivery attempt time is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_provider_identity BEFORE UPDATE OF provider_id ON vc_crm_email_outbox WHEN OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id BEGIN SELECT RAISE(ABORT,'Provider delivery identity is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_event_no_update BEFORE UPDATE ON vc_crm_email_events BEGIN SELECT RAISE(ABORT,'Email events are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_event_no_delete BEFORE DELETE ON vc_crm_email_events BEGIN SELECT RAISE(ABORT,'Email events are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_email_document_context BEFORE INSERT ON vc_crm_email_outbox
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_documents d WHERE d.id=NEW.document_id AND d.site_id=NEW.site_id AND d.constituent_id=NEW.constituent_id)
    BEGIN SELECT RAISE(ABORT,'Email requires its authorized document context'); END`,
] as const
