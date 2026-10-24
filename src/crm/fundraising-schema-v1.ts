/** Chapter-owned classifications; gifts retain immutable provenance in separate attribution rows. */
export const fundraisingSchemaV1 = [
  `ALTER TABLE vc_crm_funds ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE vc_crm_funds ADD COLUMN starts_on TEXT`,
  `ALTER TABLE vc_crm_funds ADD COLUMN ends_on TEXT`,
  ...['campaigns', 'appeals'].flatMap((table) => [
    `CREATE TABLE IF NOT EXISTS vc_crm_${table} (
      id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES vc_sites(id), name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', starts_on TEXT, ends_on TEXT, currency TEXT, exponent INTEGER,
      goal_minor TEXT, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(site_id,name),
      CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>=starts_on)
    )`,
    `CREATE INDEX IF NOT EXISTS vc_crm_${table}_site_idx ON vc_crm_${table}(site_id,archived,id)`,
  ]),
  `CREATE TABLE IF NOT EXISTS vc_crm_gift_attribution (
    gift_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_gifts(id), campaign_id TEXT REFERENCES vc_crm_campaigns(id),
    appeal_id TEXT REFERENCES vc_crm_appeals(id), revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_gift_campaign_idx ON vc_crm_gift_attribution(campaign_id,gift_id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_gift_appeal_idx ON vc_crm_gift_attribution(appeal_id,gift_id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attribution_scope_insert BEFORE INSERT ON vc_crm_gift_attribution
    WHEN (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_gifts g JOIN vc_crm_campaigns c ON c.site_id=g.site_id WHERE g.id=NEW.gift_id AND c.id=NEW.campaign_id AND c.archived=0))
      OR (NEW.appeal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_gifts g JOIN vc_crm_appeals a ON a.site_id=g.site_id WHERE g.id=NEW.gift_id AND a.id=NEW.appeal_id AND a.archived=0))
    BEGIN SELECT RAISE(ABORT,'Gift classification is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_attribution_scope_update BEFORE UPDATE ON vc_crm_gift_attribution
    WHEN NEW.gift_id<>OLD.gift_id OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_gifts g JOIN vc_crm_campaigns c ON c.site_id=g.site_id WHERE g.id=NEW.gift_id AND c.id=NEW.campaign_id AND (c.archived=0 OR NEW.campaign_id IS OLD.campaign_id)))
      OR (NEW.appeal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_gifts g JOIN vc_crm_appeals a ON a.site_id=g.site_id WHERE g.id=NEW.gift_id AND a.id=NEW.appeal_id AND (a.archived=0 OR NEW.appeal_id IS OLD.appeal_id)))
    BEGIN SELECT RAISE(ABORT,'Gift classification is unavailable'); END`,
] as const
