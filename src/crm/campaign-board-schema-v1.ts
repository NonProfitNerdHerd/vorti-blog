export const campaignBoardSchemaV1 = [
  `CREATE TABLE IF NOT EXISTS vc_crm_campaign_boards (
    campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_crm_campaigns(id),
    site_id TEXT NOT NULL REFERENCES vc_sites(id),
    board_id INTEGER NOT NULL REFERENCES task_boards(id),
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS vc_crm_campaign_boards_board ON vc_crm_campaign_boards(board_id)',
  `CREATE TRIGGER IF NOT EXISTS vc_crm_campaign_boards_site_insert BEFORE INSERT ON vc_crm_campaign_boards
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c JOIN task_boards b ON b.platform_site=c.site_id
      WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id AND b.id=NEW.board_id AND b.archived=0)
    BEGIN SELECT RAISE(ABORT,'Campaign and board must belong to the same active site'); END`,
  `CREATE TRIGGER IF NOT EXISTS vc_crm_campaign_boards_site_update BEFORE UPDATE ON vc_crm_campaign_boards
    WHEN NOT EXISTS(SELECT 1 FROM vc_crm_campaigns c JOIN task_boards b ON b.platform_site=c.site_id
      WHERE c.id=NEW.campaign_id AND c.site_id=NEW.site_id AND b.id=NEW.board_id AND b.archived=0)
    BEGIN SELECT RAISE(ABORT,'Campaign and board must belong to the same active site'); END`,
]
