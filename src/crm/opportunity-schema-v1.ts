/** Opportunity estimates and stages never create received gifts or commitments. */
export const opportunitySchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_opportunity_pipelines (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,UNIQUE(site_id,name)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunity_pipelines_site_idx ON vc_crm_opportunity_pipelines(site_id,id)`,
  `CREATE TABLE IF NOT EXISTS vc_crm_opportunity_stages (
    id TEXT PRIMARY KEY NOT NULL,pipeline_id TEXT NOT NULL REFERENCES vc_crm_opportunity_pipelines(id),name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9999),outcome TEXT NOT NULL CHECK(outcome IN('open','won','lost','declined')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,UNIQUE(pipeline_id,name)
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunity_stages_pipeline_idx ON vc_crm_opportunity_stages(pipeline_id,position,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_stage_limit BEFORE INSERT ON vc_crm_opportunity_stages
    WHEN (SELECT count(*) FROM vc_crm_opportunity_stages WHERE pipeline_id=NEW.pipeline_id)>=40
    BEGIN SELECT RAISE(ABORT,'Use at most 40 retained stages per pipeline'); END`,
  `CREATE TABLE IF NOT EXISTS vc_crm_opportunities (
    id TEXT PRIMARY KEY NOT NULL,site_id TEXT NOT NULL REFERENCES vc_sites(id),constituent_id TEXT NOT NULL REFERENCES vc_crm_constituents(id),
    name TEXT NOT NULL,pipeline_id TEXT NOT NULL REFERENCES vc_crm_opportunity_pipelines(id),stage_id TEXT NOT NULL REFERENCES vc_crm_opportunity_stages(id),
    owner_id INTEGER REFERENCES users(id),expected_minor TEXT,currency TEXT NOT NULL,exponent INTEGER NOT NULL CHECK(exponent BETWEEN 0 AND 4),
    campaign_id TEXT REFERENCES vc_crm_campaigns(id),target_on TEXT,next_action TEXT NOT NULL DEFAULT '',next_on TEXT,notes TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunities_site_idx ON vc_crm_opportunities(site_id,pipeline_id,stage_id,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunities_contact_idx ON vc_crm_opportunities(site_id,constituent_id,id)`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunities_followup_idx ON vc_crm_opportunities(site_id,owner_id,next_on,id)`,
  ...['INSERT', 'UPDATE'].map(
    (
      event,
    ) => `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_scope_${event.toLowerCase()} BEFORE ${event} ON vc_crm_opportunities
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=NEW.site_id AND a.constituent_id=NEW.constituent_id AND a.archived=0)
      OR NOT EXISTS(SELECT 1 FROM vc_crm_opportunity_stages s JOIN vc_crm_opportunity_pipelines p ON p.id=s.pipeline_id WHERE s.id=NEW.stage_id AND p.id=NEW.pipeline_id AND p.site_id=NEW.site_id)
      OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Opportunity requires chapter-scoped contacts, stages and campaigns'); END`,
  ),
  `CREATE TABLE IF NOT EXISTS vc_crm_opportunity_stage_history (
    id TEXT PRIMARY KEY NOT NULL,opportunity_id TEXT NOT NULL REFERENCES vc_crm_opportunities(id),from_stage TEXT REFERENCES vc_crm_opportunity_stages(id),
    to_stage TEXT NOT NULL REFERENCES vc_crm_opportunity_stages(id),from_label TEXT,to_label TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunity_history_idx ON vc_crm_opportunity_stage_history(opportunity_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_history_scope BEFORE INSERT ON vc_crm_opportunity_stage_history
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_opportunities o JOIN vc_crm_opportunity_stages s ON s.id=NEW.to_stage AND s.id=o.stage_id WHERE o.id=NEW.opportunity_id)
      OR (NEW.from_stage IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_opportunities o JOIN vc_crm_opportunity_stages s ON s.id=NEW.from_stage JOIN vc_crm_opportunity_pipelines p ON p.id=s.pipeline_id AND p.site_id=o.site_id WHERE o.id=NEW.opportunity_id))
    BEGIN SELECT RAISE(ABORT,'Stage history must belong to the opportunity chapter'); END`,
  `CREATE TABLE IF NOT EXISTS vc_crm_opportunity_links (
    id TEXT PRIMARY KEY NOT NULL,opportunity_id TEXT NOT NULL REFERENCES vc_crm_opportunities(id),gift_id TEXT REFERENCES vc_crm_gifts(id),
    commitment_id TEXT REFERENCES vc_crm_commitments(id),created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)),removed_at TEXT,reason TEXT NOT NULL,
    CHECK((gift_id IS NULL)<>(commitment_id IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS vc_crm_opportunity_links_idx ON vc_crm_opportunity_links(opportunity_id,removed,id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_opportunity_gift_link_idx ON vc_crm_opportunity_links(opportunity_id,gift_id) WHERE removed=0`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vc_crm_opportunity_commitment_link_idx ON vc_crm_opportunity_links(opportunity_id,commitment_id) WHERE removed=0`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_link_scope BEFORE INSERT ON vc_crm_opportunity_links
    WHEN (NEW.gift_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_opportunities o JOIN vc_crm_gifts g ON g.site_id=o.site_id AND g.constituent_id=o.constituent_id AND g.state='posted' WHERE o.id=NEW.opportunity_id AND g.id=NEW.gift_id))
      OR (NEW.commitment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc_crm_opportunities o JOIN vc_crm_commitments c ON c.site_id=o.site_id AND c.constituent_id=o.constituent_id WHERE o.id=NEW.opportunity_id AND c.id=NEW.commitment_id AND c.kind='pledge'))
    BEGIN SELECT RAISE(ABORT,'Link a recorded gift or pledge for the same chapter constituent'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_owner_fixed BEFORE UPDATE OF site_id,constituent_id,created_by,created_at ON vc_crm_opportunities BEGIN SELECT RAISE(ABORT,'Opportunity constituent and chapter history are retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_pipeline_owner_fixed BEFORE UPDATE OF site_id ON vc_crm_opportunity_pipelines BEGIN SELECT RAISE(ABORT,'Pipeline ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_stage_owner_fixed BEFORE UPDATE OF pipeline_id ON vc_crm_opportunity_stages BEGIN SELECT RAISE(ABORT,'Stage ownership is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_link_fixed BEFORE UPDATE OF opportunity_id,gift_id,commitment_id,created_by,created_at,reason ON vc_crm_opportunity_links BEGIN SELECT RAISE(ABORT,'Opportunity financial links retain their original history'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_link_removal BEFORE UPDATE OF removed ON vc_crm_opportunity_links WHEN OLD.removed=1 OR NEW.removed<>1 BEGIN SELECT RAISE(ABORT,'Link removals are final'); END`,
  ...[
    'vc_crm_opportunity_pipelines',
    'vc_crm_opportunity_stages',
    'vc_crm_opportunities',
    'vc_crm_opportunity_stage_history',
    'vc_crm_opportunity_links',
  ].map(
    (table) =>
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Opportunity history is retained'); END`,
  ),
  `CREATE TRIGGER IF NOT EXISTS vc_crm_opportunity_history_fixed BEFORE UPDATE ON vc_crm_opportunity_stage_history BEGIN SELECT RAISE(ABORT,'Opportunity stage history is immutable'); END`,
] as const
