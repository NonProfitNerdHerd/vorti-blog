/** Additive campaign, appeal and designation relationships. Existing classifications stay unlinked. */
export const fundraisingSchemaV2 = [
  `ALTER TABLE vc_crm_appeals ADD COLUMN campaign_id TEXT REFERENCES vc_crm_campaigns(id)`,
  `ALTER TABLE vc_crm_appeals ADD COLUMN default_fund_id TEXT REFERENCES vc_crm_funds(id)`,
  `ALTER TABLE vc_crm_appeals ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','planned','in_progress','completed','cancelled'))`,
  `ALTER TABLE vc_crm_appeals ADD COLUMN channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN('email','phone','mail'))`,
  `ALTER TABLE vc_crm_appeals ADD COLUMN send_on TEXT`,
  `ALTER TABLE vc_crm_appeals ADD COLUMN audience_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE vc_crm_funds ADD COLUMN internal_code TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS vc_crm_appeal_campaign_idx ON vc_crm_appeals(site_id,campaign_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_campaign_funds (
    site_id TEXT NOT NULL REFERENCES vc_sites(id), campaign_id TEXT NOT NULL REFERENCES vc_crm_campaigns(id),
    fund_id TEXT NOT NULL REFERENCES vc_crm_funds(id), created_at TEXT NOT NULL,
    PRIMARY KEY(campaign_id,fund_id)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_campaign_funds_fund_idx ON vc_crm_campaign_funds(site_id,fund_id,campaign_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_campaign_funds_scope_insert BEFORE INSERT ON vc_crm_campaign_funds
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c JOIN vc_crm_funds f ON f.site_id=c.site_id WHERE c.id=NEW.campaign_id AND f.id=NEW.fund_id AND c.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Campaign and fund must belong to the same chapter'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_campaign_funds_scope_update BEFORE UPDATE ON vc_crm_campaign_funds
    BEGIN SELECT RAISE(ABORT,'Replace campaign-fund links instead of changing ownership'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_scope_insert_v2 BEFORE INSERT ON vc_crm_appeals
    WHEN (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id))
      OR (NEW.default_fund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_funds f WHERE f.id=NEW.default_fund_id AND f.site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Appeal campaign or fund is outside this chapter'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_scope_update_v2 BEFORE UPDATE ON vc_crm_appeals
    WHEN NEW.site_id<>OLD.site_id OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id))
      OR (NEW.default_fund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_funds f WHERE f.id=NEW.default_fund_id AND f.site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Appeal campaign or fund is outside this chapter'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attribution_campaign_appeal_insert_v2 BEFORE INSERT ON vc_crm_gift_attribution
    WHEN NEW.appeal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_appeals appeal WHERE appeal.id=NEW.appeal_id AND appeal.campaign_id IS NOT NULL AND appeal.campaign_id=NEW.campaign_id)
    BEGIN SELECT RAISE(ABORT,'Gift campaign must match appeal campaign'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attribution_campaign_appeal_update_v2 BEFORE UPDATE ON vc_crm_gift_attribution
    WHEN (NEW.appeal_id IS NOT OLD.appeal_id OR NEW.campaign_id IS NOT OLD.campaign_id) AND NEW.appeal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_appeals appeal WHERE appeal.id=NEW.appeal_id AND appeal.campaign_id IS NOT NULL AND appeal.campaign_id=NEW.campaign_id)
    BEGIN SELECT RAISE(ABORT,'Gift campaign must match appeal campaign'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_campaign_attribution_update_v2 BEFORE UPDATE OF campaign_id ON vc_crm_appeals
    WHEN NEW.campaign_id IS NOT OLD.campaign_id AND EXISTS(SELECT 1 FROM vc_crm_gift_attribution attribution WHERE attribution.appeal_id=OLD.id AND (NEW.campaign_id IS NULL OR attribution.campaign_id IS NOT NEW.campaign_id))
    BEGIN SELECT RAISE(ABORT,'Appeal campaign must match attributed gifts'); END`,
  `CREATE TABLE IF NOT EXISTS vc_crm_appeal_audiences (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), appeal_id TEXT NOT NULL REFERENCES vc_crm_appeals(id),
    version INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN('manual','report')),
    source_report TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
    UNIQUE(appeal_id,version)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_appeal_recipients (
    audience_id TEXT NOT NULL REFERENCES vc_crm_appeal_audiences(id), constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    eligible INTEGER NOT NULL CHECK(eligible IN(0,1)), exclusion TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(audience_id,constituent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vc_crm_appeal_outreach (
    id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), appeal_id TEXT NOT NULL REFERENCES vc_crm_appeals(id),
    audience_id TEXT NOT NULL REFERENCES vc_crm_appeal_audiences(id), channel TEXT NOT NULL CHECK(channel IN('email','phone','mail')),
    recipient_count INTEGER NOT NULL CHECK(recipient_count>=0), notes TEXT NOT NULL, recorded_by INTEGER NOT NULL REFERENCES users(id), occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_appeal_outreach_idx ON vc_crm_appeal_outreach(site_id,appeal_id,occurred_at)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_outreach_scope BEFORE INSERT ON vc_crm_appeal_outreach
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_appeals appeal JOIN vc_crm_appeal_audiences audience ON audience.appeal_id=appeal.id AND audience.site_id=appeal.site_id WHERE appeal.id=NEW.appeal_id AND appeal.site_id=NEW.site_id AND audience.id=NEW.audience_id)
    BEGIN SELECT RAISE(ABORT,'Appeal outreach is outside its chapter'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_outreach_retained BEFORE DELETE ON vc_crm_appeal_outreach BEGIN SELECT RAISE(ABORT,'Appeal outreach history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_outreach_immutable BEFORE UPDATE ON vc_crm_appeal_outreach BEGIN SELECT RAISE(ABORT,'Appeal outreach history is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_audience_scope BEFORE INSERT ON vc_crm_appeal_audiences
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_appeals a WHERE a.id=NEW.appeal_id AND a.site_id=NEW.site_id AND a.audience_version=NEW.version)
    BEGIN SELECT RAISE(ABORT,'Appeal audience must match its chapter and version'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_recipient_scope BEFORE INSERT ON vc_crm_appeal_recipients
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_appeal_audiences audience JOIN vc_crm_affiliations affiliation ON affiliation.site_id=audience.site_id AND affiliation.constituent_id=NEW.constituent_id AND affiliation.archived=0 JOIN vc_crm_constituents contact ON contact.id=NEW.constituent_id AND contact.archived=0 WHERE audience.id=NEW.audience_id)
    BEGIN SELECT RAISE(ABORT,'Appeal recipient is unavailable in this chapter'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_audiences_retained BEFORE DELETE ON vc_crm_appeal_audiences BEGIN SELECT RAISE(ABORT,'Appeal audience history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_audiences_immutable BEFORE UPDATE ON vc_crm_appeal_audiences BEGIN SELECT RAISE(ABORT,'Appeal audience history is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_recipients_retained BEFORE DELETE ON vc_crm_appeal_recipients BEGIN SELECT RAISE(ABORT,'Appeal recipient history is retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_appeal_recipients_immutable BEFORE UPDATE ON vc_crm_appeal_recipients BEGIN SELECT RAISE(ABORT,'Appeal recipient history is immutable'); END`,
] as const
