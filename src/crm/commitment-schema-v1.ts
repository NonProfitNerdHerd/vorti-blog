export const commitmentSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_commitments (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    kind TEXT NOT NULL CHECK(kind IN('pledge','recurring')), name TEXT NOT NULL, currency TEXT NOT NULL, exponent INTEGER NOT NULL,
    amount_minor TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT, frequency TEXT NOT NULL CHECK(frequency IN('weekly','monthly','quarterly','annually')),
    campaign_id TEXT REFERENCES vc_crm_campaigns(id), state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','paused','cancelled')),
    cancelled_on TEXT, revision INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_commitment_site_idx ON vc_crm_commitments(site_id,kind,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_commitment_contact_idx ON vc_crm_commitments(site_id,constituent_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_pledge_installments (
    id TEXT PRIMARY KEY NOT NULL, commitment_id TEXT NOT NULL REFERENCES vc_crm_commitments(id), due_on TEXT NOT NULL, amount_minor TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_pledge_due_idx ON vc_crm_pledge_installments(commitment_id,due_on,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_giving_pauses (
    id TEXT PRIMARY KEY NOT NULL, commitment_id TEXT NOT NULL REFERENCES vc_crm_commitments(id), started_on TEXT NOT NULL, resumed_on TEXT,
    CHECK(resumed_on IS NULL OR resumed_on>=started_on)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_giving_pause_open_idx ON vc_crm_giving_pauses(commitment_id) WHERE resumed_on IS NULL`,
  `CREATE TABLE IF NOT EXISTS vc_crm_giving_applications (
    id TEXT PRIMARY KEY NOT NULL, commitment_id TEXT NOT NULL REFERENCES vc_crm_commitments(id), installment_key TEXT NOT NULL,
    gift_id TEXT NOT NULL REFERENCES vc_crm_gifts(id), amount_minor TEXT NOT NULL, reversed INTEGER NOT NULL DEFAULT 0 CHECK(reversed IN(0,1)),
    reason TEXT NOT NULL, created_at TEXT NOT NULL, reversed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_giving_application_gift_idx ON vc_crm_giving_applications(gift_id,reversed,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_giving_application_commitment_idx ON vc_crm_giving_applications(commitment_id,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_commitment_insert_scope BEFORE INSERT ON vc_crm_commitments
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
      OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id AND c.archived=0))
    BEGIN SELECT RAISE(ABORT,'Giving schedule requires an active chapter contact and campaign'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_commitment_terms_immutable BEFORE UPDATE OF site_id,constituent_id,kind,currency,exponent,amount_minor,starts_on,ends_on,frequency,campaign_id,created_by,created_at ON vc_crm_commitments
    BEGIN SELECT RAISE(ABORT,'Retain original giving terms; cancel and create replacement terms'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_commitment_update_scope BEFORE UPDATE ON vc_crm_commitments
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0
      WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
    BEGIN SELECT RAISE(ABORT,'Giving schedule requires an active chapter contact'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_commitment_no_delete BEFORE DELETE ON vc_crm_commitments BEGIN SELECT RAISE(ABORT,'Giving history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_installment_no_update BEFORE UPDATE ON vc_crm_pledge_installments BEGIN SELECT RAISE(ABORT,'Pledge installments are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_installment_no_delete BEFORE DELETE ON vc_crm_pledge_installments BEGIN SELECT RAISE(ABORT,'Pledge history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_application_scope BEFORE INSERT ON vc_crm_giving_applications
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_commitments c JOIN vc_crm_gifts g ON g.site_id=c.site_id AND g.constituent_id=c.constituent_id AND g.currency=c.currency AND g.exponent=c.exponent
      WHERE c.id=NEW.commitment_id AND g.id=NEW.gift_id AND g.kind<>'in-kind' AND g.state='posted')
    BEGIN SELECT RAISE(ABORT,'Payment requires a matching chapter donor, currency and cash gift'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_application_immutable BEFORE UPDATE OF commitment_id,installment_key,gift_id,amount_minor,reason,created_at ON vc_crm_giving_applications BEGIN SELECT RAISE(ABORT,'Payment application history is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_application_reversal BEFORE UPDATE OF reversed ON vc_crm_giving_applications WHEN OLD.reversed=1 OR NEW.reversed<>1 BEGIN SELECT RAISE(ABORT,'Payment reversals are final'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_application_no_delete BEFORE DELETE ON vc_crm_giving_applications BEGIN SELECT RAISE(ABORT,'Payment application history is retained'); END`,
] as const
